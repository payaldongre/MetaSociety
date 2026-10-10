/**
 * GGG — historical-policy inheritance for Pandharpur.
 *
 * WHAT GGG IS. A deterministic, inspectable information-transfer mechanism in
 * which a proposed policy (the "child") inherits historically meaningful
 * characteristics from real predecessor policies (its "parents"), adapted to
 * Pandharpur's own context. The inherited information is qualitative traits
 * (mechanism, target population, delivery route, causal pathway) plus a
 * grounded effect scale — and that scale participates in the causal simulation.
 *
 * WHAT GGG IS NOT.
 *   - It is NOT an LLM feature, a chatbot, prompt generation or generated
 *     history. It is static data (historical-policies.ts) plus arithmetic.
 *   - It is NOT Differential Evolution or NSGA-II. Those answer "which candidate
 *     performs best according to the model?" (de.ts). GGG answers "which
 *     characteristics of this policy can be inherited from policies that have
 *     really existed, and how should they be adapted here?" — before any search.
 *   - It is NOT backtesting. Backtesting compares a prediction with a documented
 *     past outcome (backtest.ts). GGG transfers characteristics INTO a new policy.
 *   - It does NOT copy a historical outcome into a simulated result. No number
 *     from a historical programme is ever reported as a simulation output.
 *
 * HOW IT ENTERS THE SIMULATION. `grounded.effectScale` (in (0,1]) is derived
 * from how comparable the selected parents are, how strong their direction
 * evidence is, and how much larger they are than this local application. The
 * engine folds it into the policy-intensity and budget bands the Bayesian
 * network reads, so a ₹12-crore local programme can no longer produce a
 * national-scheme-scale effect. See `groundedParameters` below, and the
 * magnitude rationale in simulate.ts.
 */

import { atLeast, type CalibrationStatus, type EvidenceStrength } from "./evidence";
import {
  HISTORICAL_POLICIES,
  HISTORICAL_SCALES,
  type HistoricalPolicy,
  type HistoricalScale,
} from "./historical-policies";
import { genomeFromPolicy, type PolicyGenome, type ResourceBand } from "./policy-genome";
import type { PolicyBrief } from "./policy-brief";
import type { MetricKey, PolicyVector } from "./types";

/* ------------------------------------------------------------------ */
/* Result shape                                                        */
/* ------------------------------------------------------------------ */

export interface SimilarityBreakdown {
  channel: number;
  mechanism: number;
  causalNodes: number;
  target: number;
  context: number;
  seasonality: number;
  scale: number;
  duration: number;
}

export interface ParentMatch {
  policyId: string;
  name: string;
  channel: string;
  scale: HistoricalScale;
  /** Similarity-weighted score in [0,1]. */
  overall: number;
  breakdown: SimilarityBreakdown;
  /** Plain-language reason the parent was selected. */
  reason: string;
  sharedTags: string[];
  sharedNodes: string[];
  evidenceStrength: EvidenceStrength;
}

export interface InheritedTrait {
  trait: string;
  /** Parent ids whose characteristics support this trait. */
  supportingParents: string[];
  /** Weighted share of parent support, in [0,1]. */
  confidence: number;
}

export interface AdaptationNote {
  dimension: string;
  historical: string;
  pandharpur: string;
  note: string;
}

export interface GggLineageStep {
  step: string;
  detail: string;
}

/** The grounded policy characteristics GGG hands to the causal engine. */
export interface GroundedParameters {
  /** Effect scale in (0,1] applied to the modelled policy shift. */
  effectScale: number;
  resourceBand: ResourceBand;
  intensityBand: "low" | "medium" | "high";
  durationBand: "short" | "medium" | "long";
  /** The comparability component of the scale. */
  comparability: number;
  /** The evidence component. */
  evidenceFactor: number;
  /** The scale component. */
  scaleFactor: number;
  /** Every step of the derivation, for auditability. */
  rationale: string[];
}

export interface GggInheritance {
  genome: PolicyGenome;
  parents: ParentMatch[];
  inheritedTraits: InheritedTrait[];
  adaptation: AdaptationNote[];
  evidenceStrength: EvidenceStrength;
  magnitudeCalibration: CalibrationStatus;
  grounded: GroundedParameters;
  lineage: GggLineageStep[];
  /** Honest notes: no parent found, weak evidence, uncalibrated magnitude, etc. */
  notes: string[];
}

/* ------------------------------------------------------------------ */
/* Similarity                                                          */
/* ------------------------------------------------------------------ */

/**
 * Documented dimension weights. They sum to 1. The two heaviest are mechanism
 * and channel, because those decide whether two policies share a CAUSAL PATH at
 * all — which is the property that matters for inheritance. Target population
 * and causal-node overlap come next; context, seasonality, scale and duration
 * are secondary. The exact ordering is a modelling choice, stated here so it can
 * be reviewed rather than buried.
 */
export const SIMILARITY_WEIGHTS = {
  channel: 0.22,
  mechanism: 0.24,
  causalNodes: 0.18,
  target: 0.12,
  context: 0.08,
  seasonality: 0.04,
  scale: 0.06,
  duration: 0.06,
} as const;

/** Minimum overall score for a historical policy to count as a parent. */
export const MIN_PARENT_SCORE = 0.34;

/** Maximum number of parents selected. */
export const MAX_PARENTS = 5;

function jaccard(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 0;
  const sa = new Set(a);
  const sb = new Set(b);
  let inter = 0;
  for (const x of sa) if (sb.has(x)) inter += 1;
  const union = sa.size + sb.size - inter;
  return union === 0 ? 0 : inter / union;
}

function scaleIndex(s: HistoricalScale): number {
  return HISTORICAL_SCALES.indexOf(s);
}

function contextScore(a: PolicyGenome["context"], b: HistoricalPolicy["context"]): number {
  if (a === b) return 1;
  if (a === "mixed" || b === "mixed") return 0.5;
  return 0;
}

/** Similarity of the child's genome to one historical policy. */
export function similarityTo(genome: PolicyGenome, parent: HistoricalPolicy): SimilarityBreakdown {
  const channel = genome.channelIds.includes(parent.channel) ? 1 : 0;
  const mechanism = jaccard(genome.mechanismTags, parent.mechanismTags);
  const causalNodes = jaccard(genome.bnNodes, parent.bnNodes);
  const target = jaccard(genome.targetTraits, parent.targetTraits);
  const context = contextScore(genome.context, parent.context);
  const seasonality = genome.seasonality === parent.seasonality ? 1 : 0;
  // Scale: 1 when the same administrative level, falling off with distance.
  const scale = 1 - Math.abs(scaleIndex(genome.scale) - scaleIndex(parent.scale)) / (HISTORICAL_SCALES.length - 1);
  // Duration: neutral (0.5) when the parent's duration is undocumented.
  const duration =
    parent.durationMonths === undefined
      ? 0.5
      : Math.max(0, 1 - Math.min(1, Math.abs(genome.durationMonths - parent.durationMonths) / 36));
  return { channel, mechanism, causalNodes, target, context, seasonality, scale, duration };
}

function weightedScore(b: SimilarityBreakdown): number {
  return (
    b.channel * SIMILARITY_WEIGHTS.channel +
    b.mechanism * SIMILARITY_WEIGHTS.mechanism +
    b.causalNodes * SIMILARITY_WEIGHTS.causalNodes +
    b.target * SIMILARITY_WEIGHTS.target +
    b.context * SIMILARITY_WEIGHTS.context +
    b.seasonality * SIMILARITY_WEIGHTS.seasonality +
    b.scale * SIMILARITY_WEIGHTS.scale +
    b.duration * SIMILARITY_WEIGHTS.duration
  );
}

function reasonFor(parent: HistoricalPolicy, b: SimilarityBreakdown): string {
  const parts: string[] = [];
  if (b.channel === 1) parts.push(`shares the ${parent.channel} channel`);
  if (b.mechanism >= 0.34) parts.push("overlapping mechanism");
  else if (b.mechanism > 0) parts.push("partly overlapping mechanism");
  if (b.causalNodes >= 0.3) parts.push("overlapping causal pathway");
  if (b.target >= 0.34) parts.push("similar target population");
  if (b.seasonality === 1 && parent.seasonality === "seasonal") parts.push("seasonal mechanism");
  if (b.context === 1) parts.push(`${parent.context} context`);
  if (parts.length === 0) parts.push("no strong dimension, retained only as weak evidence");
  return `${parent.name}: ${parts.join(", ")}.`;
}

/**
 * Rank historical policies for a genome, deterministically. A parent must either
 * share the channel or show real mechanism/target overlap; a different-channel
 * policy with no mechanism overlap is not a parent merely because both are
 * government programmes.
 */
export function matchHistoricalParents(genome: PolicyGenome): ParentMatch[] {
  const scored = HISTORICAL_POLICIES.map((parent) => {
    const breakdown = similarityTo(genome, parent);
    return { parent, breakdown, overall: weightedScore(breakdown) };
  })
    .filter(({ parent, breakdown, overall }) => {
      const overlap = breakdown.mechanism > 0 || breakdown.target > 0 || breakdown.causalNodes > 0;
      return overall >= MIN_PARENT_SCORE && (breakdown.channel === 1 || overlap);
    })
    .sort((a, b) => b.overall - a.overall || a.parent.id.localeCompare(b.parent.id))
    .slice(0, MAX_PARENTS);

  return scored.map(({ parent, breakdown, overall }) => ({
    policyId: parent.id,
    name: parent.name,
    channel: parent.channel,
    scale: parent.scale,
    overall,
    breakdown,
    reason: reasonFor(parent, breakdown),
    sharedTags: parent.mechanismTags.filter((t) => genome.mechanismTags.includes(t)),
    sharedNodes: parent.bnNodes.filter((n) => genome.bnNodes.includes(n)),
    evidenceStrength: parent.evidenceStrength,
  }));
}

/* ------------------------------------------------------------------ */
/* Inheritance                                                         */
/* ------------------------------------------------------------------ */

/**
 * Conservative, evidence-weighted inheritance of qualitative traits.
 *
 * A trait is inherited when the parents that carry it have meaningful combined
 * weight; its confidence is that weighted share. Traits are taken from the
 * CHILD's own vocabulary, so inheritance can only corroborate a characteristic
 * the policy already has or add a documented one — it cannot invent a trait the
 * engine has no mechanism for.
 */
export function inheritTraits(genome: PolicyGenome, parents: ParentMatch[]): InheritedTrait[] {
  if (parents.length === 0) return [];
  const totalWeight = parents.reduce((s, p) => s + p.overall, 0) || 1;
  const candidates = new Set([
    ...genome.mechanismTags,
    ...parents.flatMap((p) => {
      const hp = HISTORICAL_POLICIES.find((x) => x.id === p.policyId);
      return hp ? hp.mechanismTags : [];
    }),
  ]);

  const out: InheritedTrait[] = [];
  for (const trait of candidates) {
    let weight = 0;
    const supporting: string[] = [];
    for (const p of parents) {
      const hp = HISTORICAL_POLICIES.find((x) => x.id === p.policyId);
      if (hp && hp.mechanismTags.includes(trait)) {
        weight += p.overall;
        supporting.push(p.policyId);
      }
    }
    const confidence = weight / totalWeight;
    // A trait the child did not already carry needs stronger parent support to
    // be added, so inheritance cannot flood the genome with weakly-attested traits.
    const alreadyChild = genome.mechanismTags.includes(trait);
    if (confidence >= (alreadyChild ? 0.2 : 0.45)) {
      out.push({ trait, supportingParents: supporting, confidence });
    }
  }
  return out.sort((a, b) => b.confidence - a.confidence || a.trait.localeCompare(b.trait));
}

/* ------------------------------------------------------------------ */
/* Evidence aggregates                                                 */
/* ------------------------------------------------------------------ */

const EVIDENCE_RANK: EvidenceStrength[] = ["uncalibrated", "limited", "moderate", "high"];

function strongestEvidence(parents: ParentMatch[]): EvidenceStrength {
  return parents.reduce<EvidenceStrength>(
    (best, p) => (EVIDENCE_RANK.indexOf(p.evidenceStrength) > EVIDENCE_RANK.indexOf(best) ? p.evidenceStrength : best),
    "uncalibrated",
  );
}

/**
 * Magnitude calibration. GGG can only certify a magnitude as calibrated when a
 * parent actually carries a directly observed magnitude for the same engine
 * metric — otherwise the magnitude stays uncalibrated, however strong the
 * direction evidence is.
 */
function magnitudeCalibration(
  genome: PolicyGenome,
  parents: ParentMatch[],
): CalibrationStatus {
  const relevant = parents.flatMap((p) => {
    const hp = HISTORICAL_POLICIES.find((x) => x.id === p.policyId);
    return (hp?.observedOutcomes ?? []).filter(
      (o) => o.magnitude && o.engineMetric && genome.directTargets.includes(o.engineMetric),
    );
  });
  if (relevant.some((o) => o.category === "OBSERVED" || o.category === "HISTORICAL_OUTCOME")) return "limited";
  return "uncalibrated";
}

/* ------------------------------------------------------------------ */
/* Pandharpur adaptation                                               */
/* ------------------------------------------------------------------ */

/** Stable facts about the Pandharpur context GGG adapts to. */
export const PANDHARPUR_CONTEXT = {
  town: "Pandharpur",
  district: "Solapur",
  residents: 98923,
  households: 20054,
  residentPopulationTraits: ["urban", "small_town", "service_economy"],
  /** The Wari is a temporary seasonal visitor load, never added to residents. */
  seasonalVisitorLoad: "Ashadhi Wari (June–July): ~32 lakh pilgrim visits over three days, a temporary seasonal pressure.",
  governance: "Pandharpur Municipal Council (local), with the district administration, the Pandharpur Development Authority and state/central bodies for larger matters.",
  infrastructureConstraint:
    "Sanitation, water, rest-area and crowd-management capacity is sized for the resident town and is stretched by the seasonal load.",
} as const;

function buildAdaptation(genome: PolicyGenome, parents: ParentMatch[]): AdaptationNote[] {
  const seasonal = genome.seasonality === "seasonal";
  const nationalParents = parents.filter((p) => scaleIndex(p.scale) >= scaleIndex("state"));
  return [
    {
      dimension: "Population",
      historical: parents.length ? `${parents.length} predecessor(s), largest at ${widestScale(parents)} scale` : "no predecessor",
      pandharpur: `${PANDHARPUR_CONTEXT.residents.toLocaleString("en-IN")} residents in ${PANDHARPUR_CONTEXT.households.toLocaleString("en-IN")} households`,
      note:
        nationalParents.length > 0
          ? "A national programme covers millions of households; only its mechanism transfers, not its scale. The local effect is a small fraction of it."
          : "No large predecessor dominates; the effect is grounded on the closest local evidence.",
    },
    {
      dimension: "Seasonality",
      historical: seasonal ? "seasonal predecessors present" : "no seasonal mechanism",
      pandharpur: PANDHARPUR_CONTEXT.seasonalVisitorLoad,
      note: seasonal
        ? "The seasonal load is modelled as temporary pressure on residents, never as extra residents."
        : "No seasonal term is added unless the policy itself carries a pilgrimage channel.",
    },
    {
      dimension: "Governance",
      historical: "decided at national or state level",
      pandharpur: PANDHARPUR_CONTEXT.governance,
      note: "The local decision authority must still be competent for the domain; GGG does not bypass governance.",
    },
    {
      dimension: "Resource scale",
      historical: widestScale(parents),
      pandharpur: `policy budget ₹${(genome.budgetInr / 1e7).toFixed(2)} crore over ${genome.durationMonths} months`,
      note: "The effect scale is reduced by the administrative distance between the predecessor and this local application.",
    },
    {
      dimension: "Infrastructure",
      historical: "predecessors assumed their own delivery capacity",
      pandharpur: PANDHARPUR_CONTEXT.infrastructureConstraint,
      note: "Local delivery capacity is a constraint, not an assumption to be imported from a larger programme.",
    },
  ];
}

function widestScale(parents: ParentMatch[]): HistoricalScale {
  return parents.reduce<HistoricalScale>(
    (best, p) => (scaleIndex(p.scale) > scaleIndex(best) ? p.scale : best),
    "local",
  );
}

/* ------------------------------------------------------------------ */
/* Grounded parameters                                                 */
/* ------------------------------------------------------------------ */

/** Documented evidence multipliers. A weaker direction supports a smaller shift. */
const EVIDENCE_FACTOR: Record<EvidenceStrength, number> = {
  high: 1.0,
  moderate: 0.8,
  limited: 0.55,
  uncalibrated: 0.4,
};

/**
 * Comparability used when no historical predecessor is found.
 *
 * ABSENCE OF EVIDENCE MUST NOT BE REWARDED. This value is defined as a fixed
 * fraction of MIN_PARENT_SCORE (the score a historical policy must clear to be a
 * parent at all), so a policy with NO predecessor is always grounded WEAKER than
 * a policy with even the weakest admitted predecessor. Before this invariant a
 * no-parent policy (comparability 0.35) could receive a LARGER effect scale than
 * a policy matched to a weak predecessor (score just above 0.34), which rewarded
 * the absence of historical evidence. The invariant is structural, not tuned:
 * `NO_PARENT_COMPARABILITY < MIN_PARENT_SCORE` by construction.
 */
export const NO_PARENT_COMPARABILITY = MIN_PARENT_SCORE * 0.8;

/** Floor on the effect scale, so a policy is scaled down, never silently zeroed. */
export const MIN_EFFECT_SCALE = 0.1;

function intensityBandFor(intensity: number): "low" | "medium" | "high" {
  return intensity < 0.4 ? "low" : intensity < 0.72 ? "medium" : "high";
}
function durationBandFor(months: number): "short" | "medium" | "long" {
  return months <= 12 ? "short" : months <= 36 ? "medium" : "long";
}

/**
 * Derive the grounded effect scale.
 *
 *   effectScale = clamp(comparability × evidenceFactor × scaleFactor, MIN, 1)
 *
 * `scaleFactor = 1 / (1 + max(0, parentLevels − childLevels))` : a local
 * application of a national mechanism is taken as a fraction of the historical
 * programme's intensity, falling off with the number of administrative levels
 * between them. This is the documented rationale for reducing a small local
 * policy's modelled effect.
 */
export function groundedParameters(genome: PolicyGenome, parents: ParentMatch[]): GroundedParameters {
  const best = parents[0];
  const comparability = best ? best.overall : NO_PARENT_COMPARABILITY;
  const evidenceStrength = best ? strongestEvidence(parents) : "uncalibrated";
  const evidenceFactor = EVIDENCE_FACTOR[evidenceStrength];
  const widest = widestScale(parents);
  const levels = best ? Math.max(0, scaleIndex(widest) - scaleIndex(genome.scale)) : 0;
  const scaleFactor = 1 / (1 + levels);
  const raw = comparability * evidenceFactor * scaleFactor;
  const effectScale = Math.min(1, Math.max(MIN_EFFECT_SCALE, raw));

  const rationale = [
    `comparability: ${comparability.toFixed(3)} (${best ? `best parent "${best.name}"` : "no historical predecessor found"})`,
    `evidence factor: ${evidenceFactor} (strongest parent direction evidence: ${evidenceStrength})`,
    `scale factor: ${scaleFactor.toFixed(3)} = 1/(1+${levels}), from ${widest} predecessor to ${genome.scale} application`,
    `effect scale: clamp(${comparability.toFixed(3)} × ${evidenceFactor} × ${scaleFactor.toFixed(3)}, ${MIN_EFFECT_SCALE}, 1) = ${effectScale.toFixed(4)}`,
    "every factor is a stated model assumption; no historical outcome magnitude is copied",
  ];

  return {
    effectScale,
    resourceBand: genome.resourceBand,
    intensityBand: intensityBandFor(genome.intensity),
    durationBand: durationBandFor(genome.durationMonths),
    comparability,
    evidenceFactor,
    scaleFactor,
    rationale,
  };
}

/* ------------------------------------------------------------------ */
/* Entry point                                                         */
/* ------------------------------------------------------------------ */

/**
 * Run the full GGG pipeline for a policy:
 *   proposed policy → genome → historical matching → inheritance
 *   → Pandharpur adaptation → grounded characteristics + lineage.
 *
 * Pure and deterministic. No randomness, no language model.
 */
export function runGgg(policy: PolicyVector, brief?: PolicyBrief): GggInheritance {
  const genome = genomeFromPolicy(policy, brief);
  const parents = matchHistoricalParents(genome);
  const inheritedTraits = inheritTraits(genome, parents);
  const adaptation = buildAdaptation(genome, parents);
  const evidenceStrength = parents.length ? strongestEvidence(parents) : "uncalibrated";
  const magnitudeCal = magnitudeCalibration(genome, parents);
  const grounded = groundedParameters(genome, parents);

  const notes: string[] = [];
  if (parents.length === 0) {
    notes.push(
      "No historical predecessor met the similarity threshold. The policy runs at the conservative floor effect scale and its magnitude is explicitly uncalibrated.",
    );
    notes.push(
      "Absence of historical evidence is treated as WEAKER grounding than the weakest admitted predecessor: the no-parent comparability is a fixed fraction of the parent-admission threshold, so a policy with no predecessor can never be grounded more strongly than a matched one.",
    );
  }
  if (magnitudeCal === "uncalibrated") {
    notes.push(
      "Direction evidence exists for the mechanism, but no parent carries a directly observed magnitude on a comparable engine metric: numerical magnitude is uncalibrated.",
    );
  }
  if (grounded.effectScale <= MIN_EFFECT_SCALE + 1e-9) {
    notes.push(
      `The grounded effect scale reached its documented floor of ${MIN_EFFECT_SCALE}; the modelled effect is small by construction because a local application of a larger mechanism is weakly comparable.`,
    );
  }
  if (!atLeast(evidenceStrength, "moderate")) {
    notes.push("Evidence strength is below moderate, so the result should be read as direction-first, magnitude-last.");
  }
  if (!genome.channelIds.some((c) => genome.bnNodes.length > 0)) {
    notes.push("The policy has no Bayesian-network channel, so GGG grounds its characteristics but the engine applies no causal effect.");
  }

  const lineage: GggLineageStep[] = [
    { step: "Proposed policy", detail: `${policy.name} · channels [${policy.channelIds.join(" + ") || "none"}]` },
    {
      step: "Policy genome",
      detail: `${genome.mechanism} · target: ${genome.targetPopulation}`,
    },
    {
      step: "Historical parents",
      detail: parents.length
        ? parents.map((p) => `${p.name} (${p.overall.toFixed(2)})`).join("; ")
        : "none selected",
    },
    {
      step: "GGG inheritance",
      detail: inheritedTraits.length
        ? inheritedTraits.map((t) => t.trait).join(", ")
        : "no traits inherited (no parent support)",
    },
    {
      step: "Pandharpur adaptation",
      detail: `population ${PANDHARPUR_CONTEXT.residents.toLocaleString("en-IN")} · ${genome.seasonality === "seasonal" ? "seasonal Wari load" : "no seasonal load"} · ${genome.authorityLevel} authority`,
    },
    {
      step: "Grounded characteristics",
      detail: `effect scale ${grounded.effectScale.toFixed(3)} · evidence ${evidenceStrength} · magnitude ${magnitudeCal}`,
    },
    { step: "Causal simulation", detail: "Bayesian network at the grounded intensity/budget bands" },
    { step: "Result + uncertainty", detail: "baseline vs proposed, seed ensemble, lineage and evidence attached" },
  ];

  return {
    genome,
    parents,
    inheritedTraits,
    adaptation,
    evidenceStrength,
    magnitudeCalibration: magnitudeCal,
    grounded,
    lineage,
    notes,
  };
}

/** Convenience: the engine metric proxies a set of parents supports, if any. */
export function parentEngineMetrics(parents: ParentMatch[]): MetricKey[] {
  const out = new Set<MetricKey>();
  for (const p of parents) {
    const hp = HISTORICAL_POLICIES.find((x) => x.id === p.policyId);
    for (const o of hp?.observedOutcomes ?? []) if (o.engineMetric) out.add(o.engineMetric);
  }
  return [...out];
}
