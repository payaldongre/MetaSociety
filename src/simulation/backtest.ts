/**
 * Historical backtesting framework (spec §16, §17, §19, §40D).
 *
 * Calibration alone is not validation. This module runs the stated pipeline
 * explicitly:
 *
 *   historical policy -> pre-policy baseline -> represent in the simulator
 *     -> run the ACTUAL simulation engine -> record prediction
 *     -> compare with the documented outcome
 *
 * ENGINE-BACKED BY DEFAULT. `runEngineBacktestSuite` runs `runSimulation` (the
 * same engine the Simulation Lab uses) for every case that has a legitimate
 * representation, and derives the predicted direction from the engine's own
 * baseline-vs-treated output. `runBacktestSuite(predictor)` remains only as a
 * pure comparison harness for a caller that already holds a prediction; it never
 * invents one.
 *
 * NOT REPRESENTABLE IS A REAL STATUS. A documented case the engine cannot
 * produce (a metric with no engine analogue, or a seasonal baseline rather than
 * a policy) is reported `not_representable` with a reason — never given a
 * fabricated prediction to make the suite look complete.
 *
 * LEAKAGE (spec §17). Each case separates information available BEFORE
 * implementation (usable for inputs) from information observed AFTER
 * implementation (usable ONLY for validation). `checkNoLeakage` fails a case if
 * the same source appears on both sides, so the backtest cannot silently become
 * circular.
 */

import { CALIBRATION_LEDGER, type CalibrationEntry, type ObservedDirection } from "./calibration-ledger";
import type { CalibrationStatus, EvidenceStrength, SourceRecord } from "./evidence";
import type { AuthorityId } from "./governance";
import { runSimulation, type SimulationOptions } from "./simulate";
import type { MetricKey, PolicyVector } from "./types";

export interface BacktestRepresentation {
  channelIds: string[];
  note: string;
  /**
   * The engine representation, or null when the engine cannot legitimately
   * produce this case's observation. A null here is reported, not patched over.
   */
  engine: {
    channelIds: string[];
    intensity: number;
    budget: number;
    durationMonths: number;
    /** The engine metric that stands in for the observed quantity. */
    metric: MetricKey;
    /**
     * The observed outcome EXPRESSED IN THE ENGINE METRIC'S DIRECTION. When the
     * proxy inverts the observed metric (e.g. housing stress down == wellbeing
     * up) this differs from `observedDirection`, and `rationale` must say so.
     */
    mappedObservedDirection: ObservedDirection;
    rationale: string;
  } | null;
}

export interface BacktestCase {
  id: string;
  policy: string;
  authority: AuthorityId | "multiple";
  metric: string;
  /** Supports the direction the model should predict, in the OBSERVED metric. */
  observedDirection: ObservedDirection;
  /** A documented magnitude, ONLY where one exists. */
  observedMagnitude?: { value: number; unit: string };
  /** Known before the policy ran: usable for model inputs, never for validation. */
  informationAvailableBefore: { description: string; evidence: SourceRecord[] };
  /** Known only after the policy ran: usable ONLY for validation. */
  observedAfterImplementation: { description: string; evidence: SourceRecord[] };
  /** How the historical policy is represented in the simulator. */
  representation: BacktestRepresentation;
  evidenceStrength: EvidenceStrength;
  calibrationStatus: CalibrationStatus;
  ledgerId: string;
}

export interface BacktestPrediction {
  direction: ObservedDirection;
  /** Predicted magnitude in the same unit as the observation, when comparable. */
  magnitude?: number;
  /** The model's stated interval for the magnitude, when available. */
  uncertainty?: { low: number; high: number };
  /** Which observed direction this prediction is compared against. */
  comparedObservedDirection?: ObservedDirection;
  /** Where the prediction came from. */
  basis?: "engine" | "external";
}

/**
 * The honest verdict for a case (spec §12, §40D). Only `supported` means the
 * direction agreed AND a comparable magnitude landed inside the model's seed
 * interval; a direction-only agreement is never reported as a full success.
 */
export type BacktestStatus =
  | "supported"
  | "partially_supported"
  | "directionally_consistent"
  | "inconclusive"
  | "not_representable"
  | "insufficient_evidence";

export interface BacktestResult {
  caseId: string;
  policy: string;
  metric: string;
  status: BacktestStatus;
  /** Plain-language reason for the status, for the evaluator. */
  note: string;
  predictedDirection: ObservedDirection;
  observedDirection: ObservedDirection;
  /** The direction the prediction was compared against (proxy-aware). */
  comparedObservedDirection: ObservedDirection;
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
  leakageClean: boolean;
  leakageNote: string;
  /** The engine run behind an engine-backed prediction, for auditability. */
  engineRun?: EngineBacktestRunSummary;
}

/** What the engine actually computed for one representable case. */
export interface EngineBacktestRunSummary {
  caseId: string;
  metric: MetricKey;
  baseline: number;
  treated: number;
  delta: number;
  /** Empirical 5th–95th percentile of seed-run changes (a seed interval). */
  seedInterval: [number, number];
  seedCount: number;
  seed: number;
  runId: string;
}

/* ------------------------------------------------------------------ */
/* Leakage guard                                                       */
/* ------------------------------------------------------------------ */

/** Stable identity for a source: URL if present, else title+date. */
function sourceKey(s: SourceRecord): string {
  return s.url ?? `${s.title}|${s.date ?? ""}`;
}

/**
 * A case leaks when the same source sits on both the pre-policy and post-policy
 * sides. The check is conservative: any overlap is a leak.
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

function statusFor(
  c: BacktestCase,
  leakageClean: boolean,
  directionAgreement: boolean,
  predictedDirection: ObservedDirection,
  magnitudeErrorPct: number | undefined,
  withinUncertaintyInterval: boolean | undefined,
): { status: BacktestStatus; note: string } {
  if (!c.representation.engine) {
    return {
      status: "not_representable",
      note: c.representation.note,
    };
  }
  if (!leakageClean) {
    return {
      status: "insufficient_evidence",
      note: "Pre-policy and post-policy evidence overlap, so the comparison is not valid.",
    };
  }
  const observed = c.representation.engine.mappedObservedDirection;
  if (observed === "unclear") {
    return {
      status: "insufficient_evidence",
      note: "The documented outcome direction is unclear, so no prediction can be validated against it.",
    };
  }
  if (predictedDirection === "no_change") {
    return {
      status: "inconclusive",
      note: "The engine shows no material movement on the proxy metric at this intensity and horizon.",
    };
  }
  if (!directionAgreement) {
    return {
      status: "inconclusive",
      note: "The engine predicted the opposite direction to the documented outcome.",
    };
  }
  if (magnitudeErrorPct !== undefined && withinUncertaintyInterval !== undefined) {
    if (withinUncertaintyInterval) {
      return {
        status: "supported",
        note: "Direction agrees and the documented magnitude falls inside the engine's seed interval.",
      };
    }
    return {
      status: "partially_supported",
      note: "Direction agrees, but the documented magnitude falls outside the engine's seed interval.",
    };
  }
  return {
    status: "directionally_consistent",
    note:
      "Direction agrees on a documented engine proxy. No comparable observed magnitude exists, so this is a " +
      "directional check — not an accuracy claim.",
  };
}

/**
 * Pure comparison between a case and a prediction. Produces no prediction of its
 * own; `runEngineBacktestSuite` supplies engine-derived ones.
 */
export function runBacktest(c: BacktestCase, p: BacktestPrediction): BacktestResult {
  const leakage = checkNoLeakage(c);
  const compared = p.comparedObservedDirection ?? c.observedDirection;
  const directionAgreement = p.direction === compared;
  const predictedMagnitude = p.magnitude;
  const observedMagnitude = c.observedMagnitude?.value;

  let magnitudeErrorPct: number | undefined;
  if (predictedMagnitude !== undefined && observedMagnitude !== undefined && observedMagnitude !== 0) {
    magnitudeErrorPct = (Math.abs(predictedMagnitude - observedMagnitude) / Math.abs(observedMagnitude)) * 100;
  }

  let withinUncertaintyInterval: boolean | undefined;
  if (p.uncertainty && observedMagnitude !== undefined) {
    withinUncertaintyInterval = observedMagnitude >= p.uncertainty.low && observedMagnitude <= p.uncertainty.high;
  }

  const { status, note } = statusFor(
    c,
    leakage.clean,
    directionAgreement,
    p.direction,
    magnitudeErrorPct,
    withinUncertaintyInterval,
  );

  return {
    caseId: c.id,
    policy: c.policy,
    metric: c.metric,
    status,
    note,
    predictedDirection: p.direction,
    observedDirection: c.observedDirection,
    comparedObservedDirection: compared,
    directionAgreement,
    predictedMagnitude,
    observedMagnitude,
    magnitudeErrorPct,
    directionOnly: predictedMagnitude === undefined || observedMagnitude === undefined,
    withinUncertaintyInterval,
    calibrationStatus: c.calibrationStatus,
    evidenceStrength: c.evidenceStrength,
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

type CaseOverrides = Omit<
  BacktestCase,
  | "id"
  | "policy"
  | "authority"
  | "metric"
  | "observedDirection"
  | "observedMagnitude"
  | "evidenceStrength"
  | "calibrationStatus"
  | "ledgerId"
>;

function caseFromLedger(id: string, overrides: CaseOverrides): BacktestCase {
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
 * pre-policy and post-policy evidence channel (spec §17) and an explicit engine
 * representation, or an explicit statement that the engine cannot represent it.
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
      note:
        "The engine has no toll-cost metric. The observed quantity is the toll charged to Wari vehicles (INR), which the " +
        "simulation does not model, so no engine prediction is reported rather than a fabricated one.",
      engine: null,
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
      note:
        "This is a documented SEASONAL BASELINE (the yearly Wari load), not the effect of a policy. The engine models " +
        "seasonal pressure relative to off-season, not year-over-year footfall growth, so a policy prediction would be a " +
        "category error. Reported not representable rather than forced.",
      engine: null,
    },
  }),
  caseFromLedger("pmay-urban-housing", {
    informationAvailableBefore: {
      description:
        "Before the housing mission's local application, the town's housing stock and household composition were known; the mission's design (assistance to eligible households) was known.",
      evidence: [
        {
          sourceType: "government_document",
          authority: "Government of India / Ministry of Housing and Urban Affairs",
          title: "Pradhan Mantri Awas Yojana (Urban) — scheme design and eligibility",
          referenceYear: 2024,
          verifiedAt: "2026-10-07",
          confidence: "moderate",
          unresolved: true,
          notes: "Pre-policy scheme design; used to represent the intervention, not to validate its outcome.",
        },
      ],
    },
    observedAfterImplementation: {
      description:
        "Evaluations report that housing assistance reduces households under housing stress, though unevenly across cities.",
      evidence: [
        {
          sourceType: "programme_evaluation",
          authority: "Government of India / Ministry of Housing and Urban Affairs",
          title: "Pradhan Mantri Awas Yojana (Urban) — mission progress and evaluation",
          referenceYear: 2024,
          verifiedAt: "2026-10-07",
          confidence: "low",
          unresolved: true,
        },
      ],
    },
    representation: {
      channelIds: ["HOUSING"],
      note:
        "Represented as the engine's HOUSING channel. The observed quantity is household housing STRESS (down); the engine's " +
        "nearest faithful proxy is the wellbeing/sentiment metric, which rises when stress falls. The mapping is a documented " +
        "proxy, not a like-for-like metric.",
      engine: {
        channelIds: ["HOUSING"],
        intensity: 0.85,
        budget: 120_000_000,
        durationMonths: 18,
        metric: "happinessIndex",
        mappedObservedDirection: "increase",
        rationale:
          "Housing assistance is expected to lower housing stress; the engine reports that as higher wellbeing/sentiment, " +
          "so the observed 'stress down' is compared against the engine's 'wellbeing up'. This is an explicit proxy.",
      },
    },
  }),
  caseFromLedger("mgnrega-employment", {
    informationAvailableBefore: {
      description:
        "Before the employment-guarantee programme was applied locally, the rural labour market and prior scheme design (guaranteed days of work) were known.",
      evidence: [
        {
          sourceType: "government_document",
          authority: "Government of India",
          title: "Employment-guarantee programme design (guaranteed rural employment)",
          referenceYear: 2006,
          verifiedAt: "2026-10-07",
          confidence: "moderate",
          unresolved: true,
          notes: "Pre-policy design; used to represent the intervention.",
        },
      ],
    },
    observedAfterImplementation: {
      description:
        "Peer-reviewed evidence supports the direction: guaranteed employment raises rural wages and household consumption.",
      evidence: [
        {
          sourceType: "academic_research",
          authority: "Peer-reviewed development-economics literature on MGNREGA",
          title: "Employment-guarantee effects on rural wages and household consumption",
          referenceYear: 2019,
          verifiedAt: "2026-10-07",
          confidence: "moderate",
          unresolved: true,
        },
      ],
    },
    representation: {
      channelIds: ["LABOR_MARKET"],
      note:
        "Represented as the engine's LABOR_MARKET channel. The observed quantity is the rural wage floor / household " +
        "consumption; the engine's equivalent metric is mean household income, which the channel is documented to raise.",
      engine: {
        channelIds: ["LABOR_MARKET"],
        intensity: 0.85,
        budget: 120_000_000,
        durationMonths: 12,
        metric: "meanIncome",
        mappedObservedDirection: "increase",
        rationale: "Guaranteed employment raises earnings; the engine reports that directly as mean household income.",
      },
    },
  }),
];

/* ------------------------------------------------------------------ */
/* Engine-backed predictions                                           */
/* ------------------------------------------------------------------ */

function proxyPolicy(channelIds: string[], engine: NonNullable<BacktestRepresentation["engine"]>): PolicyVector {
  return {
    channelIds,
    name: `Backtest: ${engine.metric}`,
    intensity: engine.intensity,
    budget: engine.budget,
    durationMonths: engine.durationMonths,
    allocation: { housing: 0.2, education: 0.4, employment: 0.4 },
  };
}

/** Engine materiality threshold, matching the engine's own movement rule. */
function isMaterial(delta: number, baseline: number): boolean {
  return Math.abs(delta) > Math.max(1e-9, Math.abs(baseline) * 1e-4);
}

export interface EngineBacktestOptions {
  /** Forwarded to `runSimulation` (e.g. a smaller interval ensemble in tests). */
  simulation?: SimulationOptions;
  /** Seed for each engine run. */
  seed?: number;
  /** Cases to run; defaults to all of `BACKTEST_CASES`. */
  cases?: BacktestCase[];
}

export interface EngineBacktestOutcome {
  results: BacktestResult[];
  summary: BacktestSummary;
  /** Every engine run performed, one per representable case. */
  engineRuns: EngineBacktestRunSummary[];
}

/**
 * Run every case that has a legitimate engine representation through the ACTUAL
 * simulation engine and compare the engine's own output with the documented
 * observation. Cases without a representation are reported `not_representable`.
 *
 * The engine is only ever fed pre-policy information: the representation is a
 * fixed policy specification, never a post-policy outcome.
 */
export async function runEngineBacktestSuite(options: EngineBacktestOptions = {}): Promise<EngineBacktestOutcome> {
  const cases = options.cases ?? BACKTEST_CASES;
  const seed = options.seed ?? 20260101;
  const results: BacktestResult[] = [];
  const engineRuns: EngineBacktestRunSummary[] = [];

  for (const c of cases) {
    const engine = c.representation.engine;
    if (!engine) {
      results.push(runBacktest(c, { direction: "unclear", basis: "engine" }));
      continue;
    }

    const result = await runSimulation(
      {
        townId: "pandharpur_in_mh",
        policy: proxyPolicy(engine.channelIds, engine),
        mode: "single",
        seed,
        bnVersion: "1.1.0",
        zoneFilter: "all",
      },
      { intervalRounds: 1, ...options.simulation },
    );

    const baseline = result.baseline[engine.metric];
    const treated = result.point[engine.metric];
    const delta = treated - baseline;
    const u = result.uncertainty[engine.metric];
    const predictedDirection: ObservedDirection = !isMaterial(delta, baseline)
      ? "no_change"
      : delta > 0
        ? "increase"
        : "decrease";

    const runSummary: EngineBacktestRunSummary = {
      caseId: c.id,
      metric: engine.metric,
      baseline,
      treated,
      delta,
      seedInterval: [u.p05Delta, u.p95Delta],
      seedCount: u.seedCount,
      seed: result.seed,
      runId: result.runId,
    };
    engineRuns.push(runSummary);

    const compared = engine.mappedObservedDirection;
    const result0 = runBacktest(
      c,
      predictedDirection === "no_change"
        ? { direction: "no_change", basis: "engine", comparedObservedDirection: compared }
        : {
            direction: predictedDirection,
            basis: "engine",
            comparedObservedDirection: compared,
            // A comparable observed magnitude only exists when both sides use
            // the same unit. Where it does, the seed interval is the uncertainty.
            uncertainty: c.observedMagnitude ? { low: baseline + u.p05Delta, high: baseline + u.p95Delta } : undefined,
          },
    );
    results.push({ ...result0, engineRun: runSummary });
  }

  return { results, summary: summariseBacktests(results), engineRuns };
}

/* ------------------------------------------------------------------ */
/* Comparison harness for a supplied prediction                        */
/* ------------------------------------------------------------------ */

/**
 * Run every case with a CALLER-SUPPLIED predictor. This never invents a
 * prediction; it only compares one the caller already has. For the real
 * engine-backed path use `runEngineBacktestSuite`.
 */
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
  statusCounts: Record<BacktestStatus, number>;
  representable: number;
  notRepresentable: number;
  /** Explicit: a "success" is direction agreement AND a clean leakage check. */
  clean: boolean;
  note: string;
}

export function summariseBacktests(results: BacktestResult[]): BacktestSummary {
  const directionAgreements = results.filter((r) => r.directionAgreement).length;
  const magnitudeChecks = results.filter((r) => r.magnitudeErrorPct !== undefined).length;
  const withinIntervalChecks = results.filter((r) => r.withinUncertaintyInterval !== undefined).length;
  const leakageFailures = results.filter((r) => !r.leakageClean).length;
  const clean = leakageFailures === 0;

  const statusCounts = {
    supported: 0,
    partially_supported: 0,
    directionally_consistent: 0,
    inconclusive: 0,
    not_representable: 0,
    insufficient_evidence: 0,
  } as Record<BacktestStatus, number>;
  for (const r of results) statusCounts[r.status] += 1;

  const notRepresentable = statusCounts.not_representable;
  const representable = results.length - notRepresentable;

  const parts = [
    `${representable}/${results.length} case(s) have an engine representation`,
    `${statusCounts.directionally_consistent} directionally consistent`,
    `${statusCounts.supported} supported`,
    `${statusCounts.partially_supported} partially supported`,
    `${statusCounts.inconclusive} inconclusive`,
    `${notRepresentable} not representable`,
  ];

  return {
    total: results.length,
    directionAgreements,
    magnitudeChecks,
    withinIntervalChecks,
    leakageFailures,
    statusCounts,
    representable,
    notRepresentable,
    clean,
    note: clean
      ? `${parts.join("; ")}. Direction agreement alone is not reported as successful prediction.`
      : `LEAKAGE: ${leakageFailures} case(s) reuse post-policy evidence on the pre-policy side; results are not valid.`,
  };
}
