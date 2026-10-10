/**
 * Impact language (redesign spec §19, §20, §21, §22, §28, §29, §30).
 *
 * Turns raw engine output into the readable, evidence-labelled assessment the
 * lab must lead with. This module produces NO numbers of its own — every figure
 * it prints is read from the simulation result. Its only job is to say, in
 * plain language, what the engine computed, how strong the direction evidence
 * is, and how well the magnitude is calibrated.
 */

import { LOWER_IS_BETTER, METRIC_LABELS, METRIC_UNITS } from "./aggregate";
import type { CalibrationStatus, EvidenceStrength } from "./evidence";
import type { CausalFactor, MetricKey, MetricUncertainty, SimulationResult } from "./types";

/** Uncalibrated by default: no metric magnitude is calibrated against an evaluated programme yet. */
export function magnitudeCalibrationFor(_metric: MetricKey): CalibrationStatus {
  return "uncalibrated";
}

/**
 * Direction confidence from the seed ensemble. This is deliberately NOT called a
 * statistical confidence: a model ensemble interval is not a confidence interval
 * (spec §22), and a 12-seed ensemble does not imply 90% statistical confidence.
 */
export function directionStrengthFromEnsemble(u: MetricUncertainty): EvidenceStrength {
  if (u.seedCount <= 1) return "uncalibrated";
  const agreement = Math.max(u.improvedShare, 1 - u.improvedShare);
  if (agreement >= 0.9) return "moderate";
  if (agreement >= 0.7) return "limited";
  return "uncalibrated";
}

/**
 * Honest wording for the seed ensemble. The requirement (spec §6, §22) is that a
 * finite set of deterministic seed runs is presented as exactly that — an
 * empirical SHARE and an empirical seed interval — never as a probability that
 * the policy will work, a confidence level or a calibrated likelihood.
 *
 * The caller supplies the number formatter so the wording stays in one place
 * while the units keep the page's own formatting.
 */
export interface SeedEnsembleWording {
  /** Short label naming the denominator explicitly. */
  shareLabel: string;
  /** Full sentence: the share of simulated seed runs that improved, and out of how many. */
  shareText: string;
  /** Full sentence naming the mediation and the empirical seed interval. */
  intervalText: string;
}

export function seedEnsembleWording(
  u: MetricUncertainty,
  metric: MetricKey,
  format: (v: number) => string,
): SeedEnsembleWording {
  const label = METRIC_LABELS[metric] ?? metric;
  if (u.seedCount <= 1) {
    return {
      shareLabel: "1 simulated seed run — no seed-run share reported",
      shareText: "Only one simulated seed run is available, so no seed-run share is reported.",
      intervalText: "Only one simulated seed run is available, so no seed interval is reported.",
    };
  }
  const share = Math.round(u.improvedShare * 100);
  const improves = LOWER_IS_BETTER.includes(metric) ? "lower" : "higher";
  return {
    shareLabel: `Share of simulated seed runs showing improvement in ${label.toLowerCase()}: ${share}% of ${u.seedCount}`,
    shareText: `${share}% of the ${u.seedCount} simulated seed runs moved ${label.toLowerCase()} in the improving direction (${improves}). This is an empirical share over deterministic seed runs, not a probability.`,
    intervalText: `Median change ${format(u.medianDelta)}; empirical 5th–95th percentile of seed-run changes ${format(u.p05Delta)} to ${format(u.p95Delta)} across ${u.seedCount} seed runs — a model/seed ensemble interval, not a statistical confidence interval.`,
  };
}

/**
 * NUMERIC movement of a metric: which way the number itself went. This is
 * deliberately separate from whether that movement is desirable. Conflating the
 * two was a real bug: a falling Gini coefficient is an IMPROVEMENT, but because
 * the old helper returned the desirability as "increase", the UI drew an upward
 * arrow and printed "increase" beside a value that had gone down, and the
 * impact statement then called the improvement "adverse".
 */
export type MetricMovement = "increase" | "decrease" | "flat";

/** DESIRABILITY of the numeric movement, from `LOWER_IS_BETTER` (aggregate.ts). */
export type MetricDirection = "improving" | "adverse" | "neutral";

const VERB: Record<MetricMovement, string> = {
  increase: "increase",
  decrease: "decrease",
  flat: "stay roughly unchanged",
};

/** Which way did the number move? Sign only — no desirability judgement. */
export function movementOf(_metric: MetricKey, delta: number, material: number): MetricMovement {
  if (Math.abs(delta) <= material) return "flat";
  return delta > 0 ? "increase" : "decrease";
}

/**
 * Is that numeric movement an improvement or an adverse change for this metric?
 * Uses the single `LOWER_IS_BETTER` list, so the sign, the arrow, the
 * improvement/adverse label and the impact statement can never disagree.
 */
export function directionOf(metric: MetricKey, delta: number, material: number): MetricDirection {
  if (Math.abs(delta) <= material) return "neutral";
  const better = LOWER_IS_BETTER.includes(metric) ? delta < 0 : delta > 0;
  return better ? "improving" : "adverse";
}

/** One metric, expressed as a plain-language assessment with its evidence labels. */
export interface MetricAssessment {
  metric: MetricKey;
  label: string;
  /** NUMERIC movement of the value: increase / decrease / stay roughly unchanged. */
  movement: MetricMovement;
  /** Whether that movement is an improvement or an adverse change for this metric. */
  direction: MetricDirection;
  delta: number;
  unit: string;
  directionStrength: EvidenceStrength;
  magnitudeCalibration: CalibrationStatus;
  /** Share of the ensemble on which the metric moved toward improvement. */
  improvedShare: number;
  /** The model ensemble interval (NOT a statistical confidence interval). */
  ensembleInterval: [number, number];
  headline: string;
}

export function assessMetric(result: SimulationResult, metric: MetricKey): MetricAssessment {
  const u = result.uncertainty[metric];
  const delta = result.point[metric] - result.baseline[metric];
  const material = Math.max(1e-9, Math.abs(result.baseline[metric]) * 1e-4);
  const movement = movementOf(metric, delta, material);
  const direction = directionOf(metric, delta, material);
  const directionStrength = directionStrengthFromEnsemble(u);
  const magnitudeCalibration = magnitudeCalibrationFor(metric);
  const label = METRIC_LABELS[metric] ?? metric;
  const unit = METRIC_UNITS[metric] ?? "";

  const phrase =
    movement === "flat"
      ? `${label} is expected to ${VERB.flat} relative to the status quo.`
      : `The proposed policy is expected to ${VERB[movement]} ${label.toLowerCase()}${
          direction === "adverse" ? " (an adverse direction)" : " (an improving direction)"
        } relative to the status quo.`;

  return {
    metric,
    label,
    movement,
    direction,
    delta,
    unit,
    directionStrength,
    magnitudeCalibration,
    improvedShare: u.improvedShare,
    ensembleInterval: [u.p05Delta, u.p95Delta],
    headline: `${phrase} Direction evidence: ${directionStrength}. Magnitude calibration: ${magnitudeCalibration}.`,
  };
}

/** The single readable statement the result UI must lead with (spec §28). */
export function impactStatement(result: SimulationResult, policyName: string): string {
  const assessments = (Object.keys(result.point) as MetricKey[]).map((m) => assessMetric(result, m));
  const improving = assessments.filter((a) => a.direction === "improving");
  const adverse = assessments.filter((a) => a.direction === "adverse");
  const strongest = assessments
    .map((a) => a.directionStrength)
    .reduce<EvidenceStrength>((best, s) => (rank(s) > rank(best) ? s : best), "uncalibrated");

  const dir =
    improving.length === 0 && adverse.length === 0
      ? "is not expected to move the reported outcomes materially"
      : improving.length >= adverse.length
        ? "is expected to improve most of the reported outcomes"
        : "is expected to worsen more outcomes than it improves";

  return (
    `The proposed "${policyName}" policy ${dir} relative to the status quo. ` +
    `Direction is supported by ${strongest} evidence, while magnitude is UNCALIBRATED ` +
    `(no instrument magnitude is yet calibrated against an evaluated, comparable programme). ` +
    `${improving.length} metric(s) improve, ${adverse.length} move adversely, and ${assessments.length - improving.length - adverse.length} are roughly unchanged.`
  );
}

function rank(s: EvidenceStrength): number {
  return ["uncalibrated", "limited", "moderate", "high"].indexOf(s);
}

/* ------------------------------------------------------------------ */
/* Attribution chain (spec §29) — from the network, not an LLM         */
/* ------------------------------------------------------------------ */

export interface AttributionStep {
  node: string;
  influence: number;
}

/**
 * The engine's own causal attribution, expressed as the chain
 * Policy → direct target → intermediate mechanism → outcome. It is read from
 * `result.causalAttribution`, which is computed by the Bayesian network; no
 * language model contributes to it.
 */
export function attributionChain(result: SimulationResult, target = "EmploymentStatus"): AttributionStep[] {
  const factors: CausalFactor[] = result.causalAttribution;
  return factors.slice(0, 5).map((f) => ({ node: f.node, influence: f.influence }));
}

/** A readable rendering of the chain. */
export function describeAttribution(result: SimulationResult, target = "EmploymentStatus"): string[] {
  const chain = attributionChain(result, target);
  if (chain.length === 0) return [];
  const names = chain.map((s) => s.node);
  return [`Policy`, ...names, target];
}

/* ------------------------------------------------------------------ */
/* Uncertainty narrative (spec §20)                                    */
/* ------------------------------------------------------------------ */

export interface UncertaintyNarrative {
  /** 1. simulation randomness — the seed ensemble. */
  randomness: string;
  /** 2. parameter/model uncertainty — uncalibrated magnitudes. */
  model: string;
  /** 3. evidence uncertainty — direction vs magnitude. */
  evidence: string;
  /** A single plain-language sentence for the primary UI. */
  summary: string;
}

export function uncertaintyNarrative(result: SimulationResult): UncertaintyNarrative {
  const rounds = Object.values(result.uncertainty)[0]?.seedCount ?? 0;
  return {
    randomness: `Outcome variation across a fixed internal ensemble of ${rounds} seed round(s). This is a model ensemble interval, not a statistical confidence interval.`,
    model: "Instrument magnitudes, channel lags and behavioural weights are model parameters. They are not calibrated against an evaluated real programme, so a magnitude can be wrong even when a direction is right.",
    evidence: "Response directions are validated by the network's own directional checks; magnitudes are not. Read the interval as 'the model's plausible range', not as a forecast bound.",
    summary:
      "Likely direction, uncertain magnitude. The direction is evidence-backed; the size of the effect is not yet calibrated.",
  };
}

/* ------------------------------------------------------------------ */
/* Reproducibility (spec §21)                                          */
/* ------------------------------------------------------------------ */

export interface ReproducibilityInfo {
  engineVersion: string;
  calibrationVersion: string;
  reproducibilityId: string;
  ensembleProtocol: string;
  populationManifest: string;
  seedNote: string;
}

export function reproducibilityInfo(result: SimulationResult): ReproducibilityInfo {
  return {
    engineVersion: `BN ${result.engine.bn}${result.engine.de ? ` · ${result.engine.de}` : ""} · decision ${result.engine.decision}`,
    calibrationVersion: "1.0.0",
    reproducibilityId: result.runId,
    ensembleProtocol: `Fixed internal seed ensemble (${Object.values(result.uncertainty)[0]?.seedCount ?? 0} rounds); no user-facing seed input.`,
    populationManifest: result.populationManifest,
    seedNote: "Seeds are implementation metadata, not policy parameters. Identical (population, policy, engine version, seed protocol) reproduces the same result.",
  };
}
