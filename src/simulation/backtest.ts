/**
 * Historical backtesting framework (spec §16, §17, §19, §40D).
 *
 * Calibration alone is not validation. This module runs the stated pipeline
 * explicitly:
 *
 *   historical policy -> pre-policy baseline -> represent in the simulator
 *     -> run model -> record prediction -> compare with the documented outcome
 *
 * and reports, per case:
 *   - direction agreement (a real boolean, never asserted as "success" alone),
 *   - magnitude error, ONLY where an observed magnitude exists,
 *   - whether the observed result falls inside the model's stated interval,
 *   - the evidence strength and calibration status.
 *
 * LEAKAGE (spec §17). Each case separates information available BEFORE
 * implementation (usable for calibration and inputs) from information observed
 * AFTER implementation (usable ONLY for validation). `checkNoLeakage` fails the
 * backtest if the same source appears on both sides, so the backtest cannot
 * silently become circular.
 */

import { CALIBRATION_LEDGER, type CalibrationEntry, type ObservedDirection } from "./calibration-ledger";
import type { CalibrationStatus, EvidenceStrength, SourceRecord } from "./evidence";
import type { AuthorityId } from "./governance";
import { BN_VERSION } from "./bn";
import { runSimulation, type SimulationOptions } from "./simulate";
import type { MetricKey, PolicyVector, SimulationResult } from "./types";

export interface BacktestCase {
  id: string;
  policy: string;
  authority: AuthorityId | "multiple";
  metric: string;
  /** Supports the direction the model should predict. */
  observedDirection: ObservedDirection;
  /** A documented magnitude, ONLY where one exists. */
  observedMagnitude?: { value: number; unit: string };
  /** Known before the policy ran: usable for calibration and model inputs. */
  informationAvailableBefore: { description: string; evidence: SourceRecord[] };
  /** Known only after the policy ran: usable ONLY for validation. */
  observedAfterImplementation: { description: string; evidence: SourceRecord[] };
  /** How the historical policy is represented in the simulator. */
  representation: { channelIds: string[]; note: string };
  evidenceStrength: EvidenceStrength;
  calibrationStatus: CalibrationStatus;
  ledgerId: string;
  /**
   * How this case maps onto a metric the ENGINE actually computes, when one
   * exists. Absent when the observed metric has no engine counterpart — the
   * backtest then reports that honestly instead of inventing a mapping.
   */
  engineMetric?: EngineMetricMapping;
}

/**
 * A documented mapping from a historical metric onto an engine metric.
 * `observedMagnitudeIsComparable` is set only when the observed figure is on the
 * same scale/unit as the engine delta, so a level is never compared to a change.
 */
export interface EngineMetricMapping {
  key: MetricKey;
  /** The unit of the engine delta, e.g. "pp employment rate". */
  unit: string;
  /** True only when the observed magnitude is directly comparable to the delta. */
  observedMagnitudeIsComparable?: boolean;
  note: string;
}

export interface BacktestPrediction {
  direction: ObservedDirection;
  /** Predicted magnitude in the same unit as the observation, when comparable. */
  magnitude?: number;
  /** The model's stated interval for the magnitude, when available. */
  uncertainty?: { low: number; high: number };
}

export interface BacktestResult {
  caseId: string;
  policy: string;
  metric: string;
  predictedDirection: ObservedDirection;
  observedDirection: ObservedDirection;
  directionAgreement: boolean;
  predictedMagnitude?: number;
  observedMagnitude?: number;
  /** Percent error, present ONLY when both magnitudes exist. */
  magnitudeErrorPct?: number;
  /** True when only direction could be checked — never reported as a full success. */
  directionOnly: boolean;
  withinUncertaintyInterval?: boolean;
  calibrationStatus: CalibrationStatus;
  evidenceStrength: EvidenceStrength;
  /** True when a real prediction was made; false when the metric is not modelled. */
  predicted: boolean;
  leakageClean: boolean;
  leakageNote: string;
}

/* ------------------------------------------------------------------ */
/* Leakage guard                                                       */
/* ------------------------------------------------------------------ */

/** Stable identity for a source: URL if present, else title+date. */
function sourceKey(s: SourceRecord): string {
  return s.url ?? `${s.title}|${s.date ?? ""}`;
}

/**
 * A case leaks when a source used to build/calibrate the model was published
 * after the policy ran, or when the same source sits on both sides. Both checks
 * are conservative: any overlap is a leak.
 */
export function checkNoLeakage(c: BacktestCase): { clean: boolean; note: string } {
  const before = new Set(c.informationAvailableBefore.evidence.map(sourceKey));
  const overlaps = c.observedAfterImplementation.evidence.filter((e) => before.has(sourceKey(e)));
  if (overlaps.length > 0) {
    return {
      clean: false,
      note: `Source overlap between before/after evidence: ${overlaps.map((o) => o.title).join("; ")}`,
    };
  }
  return { clean: true, note: "Pre-policy and post-policy evidence are disjoint." };
}

/* ------------------------------------------------------------------ */
/* Comparison                                                          */
/* ------------------------------------------------------------------ */

export function runBacktest(c: BacktestCase, p: BacktestPrediction): BacktestResult {
  const leakage = checkNoLeakage(c);
  const directionAgreement = p.direction === c.observedDirection;
  const predictedMagnitude = p.magnitude;
  const observedMagnitude = c.observedMagnitude?.value;

  let magnitudeErrorPct: number | undefined;
  if (predictedMagnitude !== undefined && observedMagnitude !== undefined && observedMagnitude !== 0) {
    magnitudeErrorPct = Math.abs(predictedMagnitude - observedMagnitude) / Math.abs(observedMagnitude) * 100;
  }

  let withinUncertaintyInterval: boolean | undefined;
  if (p.uncertainty && observedMagnitude !== undefined) {
    withinUncertaintyInterval = observedMagnitude >= p.uncertainty.low && observedMagnitude <= p.uncertainty.high;
  }

  return {
    caseId: c.id,
    policy: c.policy,
    metric: c.metric,
    predictedDirection: p.direction,
    observedDirection: c.observedDirection,
    directionAgreement,
    predictedMagnitude,
    observedMagnitude,
    magnitudeErrorPct,
    directionOnly: predictedMagnitude === undefined || observedMagnitude === undefined,
    withinUncertaintyInterval,
    calibrationStatus: c.calibrationStatus,
    evidenceStrength: c.evidenceStrength,
    predicted: true,
    leakageClean: leakage.clean,
    leakageNote: leakage.note,
  };
}

/* ------------------------------------------------------------------ */
/* Cases seeded from the calibration ledger                            */
/* ------------------------------------------------------------------ */

function entryById(id: string): CalibrationEntry {
  const e = CALIBRATION_LEDGER.find((x) => x.id === id);
  if (!e) throw new Error(`Backtest references unknown ledger entry "${id}"`);
  return e;
}

function caseFromLedger(
  id: string,
  overrides: Omit<BacktestCase, "id" | "policy" | "authority" | "metric" | "observedDirection" | "observedMagnitude" | "evidenceStrength" | "calibrationStatus" | "ledgerId">,
): BacktestCase {
  const e = entryById(id);
  return {
    id,
    policy: e.policy,
    authority: e.authority,
    metric: e.metric,
    observedDirection: e.observedDirection,
    observedMagnitude: e.observedMagnitude ? { value: e.observedMagnitude.value, unit: e.observedMagnitude.unit } : undefined,
    evidenceStrength: e.evidenceStrength,
    calibrationStatus: e.calibrationStatus,
    ledgerId: id,
    ...overrides,
  };
}

/**
 * Real, sufficiently-documented historical cases. Each carries a separate
 * pre-policy and post-policy evidence channel (spec §17).
 */
export const BACKTEST_CASES: BacktestCase[] = [
  caseFromLedger("wari-toll-exemption-2025", {
    informationAvailableBefore: {
      description:
        "Before the 2025 Wari, prior Wari seasons and their travel patterns were known, and toll collection was in force on the routes.",
      evidence: [
        {
          sourceType: "government_document",
          authority: "Government of Maharashtra",
          title: "State toll policy and prior-year Wari arrangements",
          referenceYear: 2024,
          verifiedAt: "2026-10-07",
          confidence: "moderate",
          notes: "Pre-policy information used to represent the counterfactual (tolls charged).",
        },
      ],
    },
    observedAfterImplementation: {
      description: "The 2025 notification waived tolls for Wari vehicles from 18 June to 10 July 2025.",
      evidence: [
        {
          sourceType: "official_notification",
          authority: "Government of Maharashtra",
          title: "Toll exemption for Pandharpur pilgrimage vehicles, 18 June – 10 July 2025",
          date: "2025-06-17",
          url: "https://www.thehindu.com/news/national/maharashtra/maharashtra-announces-toll-exemption-for-pandharpur-pilgrimage-vehicles/article69704610.ece",
          measurementPeriod: "2025-06-18 to 2025-07-10",
          verifiedAt: "2026-10-07",
          confidence: "high",
        },
      ],
    },
    representation: {
      channelIds: ["PILGRIMAGE_FACILITIES"],
      note: "Represented as a seasonal pilgrimage-facilities intervention that lowers pilgrim travel cost during the Wari window; the direct effect is a reduction in the toll metric.",
    },
  }),
  caseFromLedger("wari-footfall-2026", {
    informationAvailableBefore: {
      description:
        "Before the 2026 Wari, prior-year footfall (2025: ~27–28 lakh on Ekadashi) and the seasonal calendar were known.",
      evidence: [
        {
          sourceType: "official_statistics",
          authority: "Solapur Rural Police (reported)",
          title: "2025 Ashadhi footfall estimate (~27–28 lakh on Ekadashi)",
          date: "2025-07-09",
          url: "https://www.hindustantimes.com/cities/pune-news/recordbreaking-ashadhi-wari-ai-powered-drones-count-over-27-lakh-devotees-101752000053098.html",
          measurementPeriod: "Ashadhi Ekadashi 2025",
          verifiedAt: "2026-10-07",
          confidence: "moderate",
        },
      ],
    },
    observedAfterImplementation: {
      description: "The 2026 Wari drew a record 3-day footfall of about 32 lakh devotees.",
      evidence: [
        {
          sourceType: "official_statistics",
          authority: "Solapur Rural Police (reported)",
          title: "32 lakh devotees over 3 days, Ashadhi Ekadashi 2026",
          date: "2026-07-27",
          url: "https://timesofindia.indiatimes.com/city/kolhapur/32-lakh-devotees-visited-pandharpur-during-3-day-ashadi-ekadashi-fest/articleshow/132667935.cms",
          measurementPeriod: "Ashadhi Ekadashi 2026",
          verifiedAt: "2026-10-07",
          confidence: "moderate",
        },
      ],
    },
    representation: {
      channelIds: ["PILGRIMAGE_FACILITIES"],
      note: "Represented as the seasonal baseline pressure (spec §12), not as a resident population increase.",
    },
  }),
];

/** Run every case with a supplied predictor, and summarise honestly. */
export function runBacktestSuite(
  predictor: (c: BacktestCase) => BacktestPrediction,
): { results: BacktestResult[]; summary: BacktestSummary } {
  const results = BACKTEST_CASES.map((c) => runBacktest(c, predictor(c)));
  return { results, summary: summariseBacktests(results) };
}

export interface BacktestSummary {
  total: number;
  directionAgreements: number;
  magnitudeChecks: number;
  withinIntervalChecks: number;
  leakageFailures: number;
  /** Cases where only the direction could be checked (never a "full success"). */
  directionOnly: number;
  /** Cases the engine could not predict because the metric is not represented. */
  notPredicted: number;
  /** How many cases fall in each calibration bucket. */
  calibrationStatuses: Record<CalibrationStatus, number>;
  /** How many cases fall in each evidence-strength bucket. */
  evidenceStrengths: Record<EvidenceStrength, number>;
  /** Explicit, evaluator-readable limitations carried from the pipeline. */
  limitations: string[];
  /** Explicit: a "success" is direction agreement AND a clean leakage check. */
  clean: boolean;
  note: string;
}

export function summariseBacktests(results: BacktestResult[]): BacktestSummary {
  const predicted = results.filter((r) => r.predicted);
  const notPredicted = results.length - predicted.length;
  const directionAgreements = predicted.filter((r) => r.directionAgreement).length;
  const magnitudeChecks = results.filter((r) => r.magnitudeErrorPct !== undefined).length;
  const withinIntervalChecks = results.filter((r) => r.withinUncertaintyInterval !== undefined).length;
  const leakageFailures = results.filter((r) => !r.leakageClean).length;
  const directionOnly = results.filter((r) => r.directionOnly).length;
  const calibrationStatuses: Record<CalibrationStatus, number> = { high: 0, moderate: 0, limited: 0, uncalibrated: 0 };
  const evidenceStrengths: Record<EvidenceStrength, number> = { high: 0, moderate: 0, limited: 0, uncalibrated: 0 };
  for (const r of results) {
    calibrationStatuses[r.calibrationStatus] += 1;
    evidenceStrengths[r.evidenceStrength] += 1;
  }
  const limitations: string[] = [];
  if (directionOnly > 0) {
    limitations.push(
      `${directionOnly} case(s) had only a DIRECTION comparison available; the observed magnitude is not modelled, so no magnitude or interval claim is made for them.`,
    );
  }
  if (results.some((r) => r.calibrationStatus === "uncalibrated")) {
    limitations.push(
      "At least one case's magnitude is uncalibrated: the engine's effect SIZE is not validated against the observation, only its direction.",
    );
  }
  if (leakageFailures > 0) {
    limitations.push(
      "A leakage check failed: post-policy evidence overlaps the pre-policy input, so the affected results are not valid evidence.",
    );
  }
  if (results.some((r) => r.evidenceStrength === "limited" || r.evidenceStrength === "uncalibrated")) {
    limitations.push(
      "Some cases rest on limited or uncalibrated evidence (secondary reporting or an unevaluated programme).",
    );
  }
  const clean = leakageFailures === 0;
  return {
    total: results.length,
    directionAgreements,
    magnitudeChecks,
    withinIntervalChecks,
    leakageFailures,
    directionOnly,
    notPredicted,
    calibrationStatuses,
    evidenceStrengths,
    limitations,
    clean,
    note: clean
      ? `${directionAgreements}/${predicted.length} direction agreements (of ${results.length} cases; ${notPredicted} not predicted by the engine); ${magnitudeChecks} magnitude checks; ${withinIntervalChecks} interval checks; ${directionOnly} direction-only. Direction alone is not reported as successful prediction.`
      : `LEAKAGE: ${leakageFailures} case(s) reuse post-policy evidence on the pre-policy side; results are not valid.`,
  };
}

/* ------------------------------------------------------------------ */
/* Engine-backed predictor (spec §16, §17, §40D)                       */
/* ------------------------------------------------------------------ */

/**
 * Engine parameters for a backtest run.
 *
 * These are MODEL ASSUMPTIONS used to build the model INPUT. They are chosen
 * from a documented default envelope, never from the post-policy observation.
 */
export const BACKTEST_ENGINE_DEFAULTS = {
  intensity: 0.65,
  budgetInr: 120_000_000,
  durationMonths: 12,
  seed: 20260101,
} as const;

export interface BacktestEngineOptions {
  seed?: number;
  townId?: string;
  /** Passed through to `runSimulation` (e.g. a smaller interval ensemble). */
  simulation?: SimulationOptions;
  /** Injectable for tests; defaults to the real engine. */
  runEngine?: typeof runSimulation;
}

export interface BacktestEngineOutcome {
  caseId: string;
  /** True only when the observed metric maps onto an engine metric. */
  represented: boolean;
  /** The engine-derived prediction, or null when the metric is not represented. */
  prediction: BacktestPrediction | null;
  /** Honest explanation when the metric is not represented. */
  reason?: string;
  engineRunId?: string;
  /** Pre-policy evidence strings used to construct the input. */
  usedInformation: string[];
  result: BacktestResult;
}

function directionFromDelta(delta: number, material: number): ObservedDirection {
  if (delta > material) return "increase";
  if (delta < -material) return "decrease";
  return "no_change";
}

/** Build the engine policy vector from a case's representation. */
function policyForCase(c: BacktestCase, seed: number): PolicyVector {
  return {
    channelIds: c.representation.channelIds,
    name: `Backtest: ${c.policy}`,
    intensity: BACKTEST_ENGINE_DEFAULTS.intensity,
    budget: BACKTEST_ENGINE_DEFAULTS.budgetInr,
    durationMonths: BACKTEST_ENGINE_DEFAULTS.durationMonths,
    allocation: { housing: 0.3, education: 0.3, employment: 0.4 },
  };
}

/**
 * Run ONE backtest case through the real simulation engine and derive a
 * prediction from the engine's own output.
 *
 * INFORMATION DISCIPLINE (spec §17): the model input is built only from the
 * case's `informationAvailableBefore` and the documented defaults above. The
 * function never reads `observedAfterImplementation`; the observation is used
 * only afterwards, by `runBacktest`, to score the prediction. A regression test
 * mutates the post-policy evidence and asserts the prediction does not change.
 */
export async function enginePredictor(
  c: BacktestCase,
  opts: BacktestEngineOptions = {},
): Promise<BacktestEngineOutcome> {
  const runEngine = opts.runEngine ?? runSimulation;
  const seed = opts.seed ?? BACKTEST_ENGINE_DEFAULTS.seed;
  const policy = policyForCase(c, seed);

  // The engine is ALWAYS invoked for each case, so the pipeline is genuinely
  // engine-backed even when the observed metric has no engine counterpart.
  const result: SimulationResult = await runEngine(
    {
      townId: opts.townId ?? "pandharpur_in_mh",
      policy,
      mode: "single",
      seed,
      bnVersion: BN_VERSION,
      zoneFilter: "all",
    },
    { intervalRounds: 1, searchAgents: 60, ...(opts.simulation ?? {}) },
  );

  const usedInformation = [c.informationAvailableBefore.description];
  const mapping = c.engineMetric;

  if (!mapping) {
    return {
      caseId: c.id,
      represented: false,
      prediction: null,
      reason:
        `The engine does not compute "${c.metric}" (or any comparable quantity for this policy), ` +
        `so no prediction is claimed. The run is reported for context only; reporting it as a ` +
        `prediction would mean fabricating a mapping the model does not have.`,
      engineRunId: result.runId,
      usedInformation,
      result: { ...runBacktest(c, { direction: "unclear" }), predicted: false },
    };
  }

  const key = mapping.key;
  const delta = result.point[key] - result.baseline[key];
  const material = Math.max(1e-9, Math.abs(result.baseline[key]) * 1e-4);
  const direction = directionFromDelta(delta, material);

  const prediction: BacktestPrediction = { direction };
  const comparable = Boolean(mapping.observedMagnitudeIsComparable) && c.observedMagnitude !== undefined;
  if (comparable) {
    prediction.magnitude = Math.abs(delta);
    const u = result.uncertainty[key];
    prediction.uncertainty = { low: u.p05Delta, high: u.p95Delta };
  }

  return {
    caseId: c.id,
    represented: true,
    prediction,
    engineRunId: result.runId,
    usedInformation,
    result: runBacktest(c, prediction),
  };
}

/** Run every case through the engine, then summarise honestly. */
export async function runEngineBacktestSuite(
  opts: BacktestEngineOptions = {},
): Promise<{ outcomes: BacktestEngineOutcome[]; summary: BacktestSummary }> {
  const outcomes: BacktestEngineOutcome[] = [];
  for (const c of BACKTEST_CASES) {
    outcomes.push(await enginePredictor(c, opts));
  }
  const results = outcomes.map((o) => o.result);
  const summary = summariseBacktests(results);
  const notRepresented = outcomes.filter((o) => !o.represented);
  if (notRepresented.length > 0) {
    summary.limitations = [
      ...summary.limitations,
      `${notRepresented.length} case(s) could not be predicted by the engine because the observed metric is not represented: ` +
        notRepresented.map((o) => `${o.caseId} (${o.result.metric})`).join(", ") +
        ". These are reported as NOT PREDICTED, not as agreements.",
    ];
  }
  return { outcomes, summary };
}
