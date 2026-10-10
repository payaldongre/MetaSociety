/**
 * Meta Society — Simulation Lab engine: shared types and domain vocabularies.
 *
 * Design law (see SIMULATION_LAB_SPEC.md §2): this engine is DECISIVE, not generative.
 * Every number it returns is a deterministic function of
 *   (population, policy vector, engine version, seed).
 * No language model produces an outcome, a magnitude, or a narrative.
 */

import type { PolicyBrief } from "./policy-brief";
import type { GggInheritance } from "./ggg";
import type { ShockReport, ShockScenarioConfig } from "./shocks";

/* ------------------------------------------------------------------ */
/* Spatial + demographic vocabularies                                  */
/* ------------------------------------------------------------------ */

export const ZONES = ["east", "west", "north", "south"] as const;
export type Zone = (typeof ZONES)[number];

export const SEXES = ["M", "F"] as const;
export type Sex = (typeof SEXES)[number];

export const AGE_BANDS = ["0-6", "7-14", "15-24", "25-34", "35-44", "45-54", "55-64", "65+"] as const;
export type AgeBand = (typeof AGE_BANDS)[number];

export const INCOME_CLASSES = ["bpl", "low", "lower_middle", "middle", "upper_middle", "high"] as const;
export type IncomeClass = (typeof INCOME_CLASSES)[number];

/** Display labels for the income bands. */
export const INCOME_CLASS_LABELS: Record<IncomeClass, string> = {
  bpl: "Below poverty line",
  low: "Low",
  lower_middle: "Lower middle",
  middle: "Middle",
  upper_middle: "Upper middle",
  high: "High",
};

export const SECTORS = [
  "agriculture",
  "manufacturing",
  "services",
  "pilgrimage_tourism",
  "construction",
  "trade",
  "public_admin",
  "informal_other",
] as const;
export type Sector = (typeof SECTORS)[number];

export const EDUCATION_LEVELS = ["none", "primary", "secondary", "higher_secondary", "graduate"] as const;
export type EducationLevel = (typeof EDUCATION_LEVELS)[number];

export const WORKER_STATUSES = ["non_worker", "main", "marginal"] as const;
export type WorkerStatus = (typeof WORKER_STATUSES)[number];

export const EMPLOYMENT_STATUSES = ["unemployed", "informal", "formal"] as const;
export type EmploymentStatus = (typeof EMPLOYMENT_STATUSES)[number];

export const QUALITY_LEVELS = ["poor", "adequate", "good"] as const;
export type QualityLevel = (typeof QUALITY_LEVELS)[number];

export const SENTIMENTS = ["negative", "neutral", "positive"] as const;
export type Sentiment = (typeof SENTIMENTS)[number];

/**
 * Internal engine/BN behaviour family.
 *
 * A policy is no longer one of these — it is a NAME plus a SET OF CHANNELS (see
 * channel-dictionary.ts). This vocabulary survives only as the engine's internal
 * abstraction: each channel maps to one engine family (instruments.ts), and the
 * Bayesian node `PolicyType` is drawn from this fixed domain. The ORDER is
 * deliberately unchanged from the old closed enum so the network's conditional
 * tables and reproducibility are preserved.
 */
export const ENGINE_INSTRUMENTS = [
  "none",
  "tax",
  "subsidy",
  "regulation",
  "housing",
  "labor",
  "education",
  "health",
] as const;
export type EngineInstrument = (typeof ENGINE_INSTRUMENTS)[number];

/** How a given field was obtained. Rendered in the UI's provenance panel. */
export const PROVENANCE_TAGS = ["census2011", "estimated", "modelled", "assumed"] as const;
export type ProvenanceTag = (typeof PROVENANCE_TAGS)[number];

/* ------------------------------------------------------------------ */
/* Population                                                          */
/* ------------------------------------------------------------------ */

/**
 * A citizen agent, stored as struct-of-arrays (see `Population`).
 * The agent is a PERSON living in a HOUSEHOLD in a WARD in a ZONE in a TOWN.
 * It is never a town, never a zone, and never a "representative citizen".
 */
export interface Population {
  townId: string;
  townName: string;
  size: number;
  households: number;
  seed: number;
  /** FNV-1a hash over the generation inputs. Changes if any input changes. */
  manifest: string;
  generatorVersion: string;

  // --- static attributes (never change during a run) ---
  age: Uint8Array;
  ageBand: Uint8Array;
  sex: Uint8Array;
  ward: Uint8Array;
  zone: Uint8Array;
  household: Uint32Array;
  scSt: Uint8Array; // 0 = general, 1 = SC, 2 = ST
  literate: Uint8Array;
  education: Uint8Array;
  workerStatus: Uint8Array;
  sector: Uint8Array;
  /** Household earning class, derived from household earning capacity per capita. */
  incomeClass: Uint8Array;
  /** Monthly individual earnings in INR (0 for non-workers). */
  income: Float64Array;

  // --- modelled attributes ---
  housing: Uint8Array;
  healthInsurance: Uint8Array;
  infra: Uint8Array;
  informality: Uint8Array;
  /** Per-sector automation/augmentation exposure mean, 0..1. */
  taskExposure: Float64Array;

  // --- latent behavioural parameters (sampled once, fixed within a run) ---
  riskAversion: Float64Array;
  timePreference: Float64Array;
  mobility: Float64Array;
  socialInfluence: Float64Array;

  // --- dynamic state (mutates across simulation periods) ---
  active: Uint8Array; // 0 once an agent has migrated out
  employed: Uint8Array;
  employmentStatus: Uint8Array;
  /** Stock: how many months of essential spending the household can absorb. */
  savingsMonths: Float64Array;
  sentiment: Uint8Array;
  trustInGov: Float64Array;
  protestPropensity: Float64Array;
  migrationIntent: Float64Array;
  skillRelevance: Float64Array;
  /** Sampled per-period sector output state: 0 declining, 1 stable, 2 rising. */
  outputState: Uint8Array;

  /** Household-level aggregates, recomputed from members. */
  householdSize: Uint32Array;
  householdIncome: Float64Array;
}

/* ------------------------------------------------------------------ */
/* Policy vector                                                       */
/* ------------------------------------------------------------------ */

export interface PolicyAllocation {
  housing: number;
  education: number;
  employment: number;
}

/** The real-valued vector Differential Evolution searches over (§11.1). */
export interface PolicyParams {
  /** 0..1 share of the instrument's maximum strength. */
  intensity: number;
  /** Total budget in INR. */
  budget: number;
  /** 3..60 months. */
  durationMonths: number;
  allocation: PolicyAllocation;
}

export interface PolicyVector extends PolicyParams {
  /**
   * Confirmed set of channels this policy touches. This replaces the old closed
   * `PolicyType` enum: a policy is a name plus one or more channels, and the
   * engine derives its behaviour family from the set (see instruments.ts).
   */
  channelIds: string[];
  name: string;
}

/* ------------------------------------------------------------------ */
/* Bayesian network                                                    */
/* ------------------------------------------------------------------ */

export type BnNodeKind = "root" | "micro" | "town" | "feedback";

export interface BnNode {
  id: string;
  domain: string[];
  parents: string[];
  /** Which scheduling layer the node belongs to (see bn.ts SCHEDULE). */
  kind: BnNodeKind;
}

export interface Cpt {
  node: string;
  /**
   * Keyed by parent state indices joined with "|" (empty string for a root).
   * Value is a distribution over the node's own domain.
   */
  table: Record<string, number[]>;
  marginal: number[];
  source: string;
  /** estimated_from_population | prior:literature | prior:assumption */
  provenance: string;
}

export interface Bn {
  version: string;
  nodes: Record<string, BnNode>;
  /** Topological order within the micro + feedback layers. */
  order: string[];
  cpts: Record<string, Cpt>;
}

export interface CausalFactor {
  node: string;
  /** Expected total-variation in the target's distribution when this node is fixed. */
  influence: number;
}

/* ------------------------------------------------------------------ */
/* Decisions (System One layer, §8)                                    */
/* ------------------------------------------------------------------ */

export interface Decision<T = string> {
  answer: T;
  distribution: Record<string, number>;
  confidence: number;
}

/**
 * A typed question with a declared answer set.
 *
 * `signals` carries the numeric read of the situation (0..1) so a deterministic
 * rule-based engine can answer meaningfully, while model-backed engines
 * serialise the same signals into the state text they send.
 */
export interface ChoiceQuestion<T extends string = string> {
  key: string;
  options: readonly T[];
  prompt: string;
  /** The situation read, 0..1. */
  value: number;
  /** How much each option is favoured by the situation. */
  lifts?: number[];
}

export interface ScoreQuestion {
  key: string;
  rubric: readonly string[];
  prompt: string;
  /** Where the situation sits on the rubric, 0..1. */
  value: number;
}

export interface NoulResult {
  key: string;
  probability: number;
  confidence: number;
}

/** A `Noul` primitive: probability that a statement about the state is true. */
export interface NoulQuestion {
  key: string;
  statement: string;
  /** The situation read, 0..1, interpreted as P(statement is true). */
  value: number;
}

export interface DecisionEngine {
  readonly name: string;
  choose<T extends string>(state: string, q: ChoiceQuestion<T>): Promise<Decision<T>>;
  score(state: string, q: ScoreQuestion): Promise<Decision>;
  evaluate(state: string, statements: NoulQuestion[]): Promise<NoulResult[]>;
  /** Reset per-run counters. */
  reset(): void;
  stats(): DecisionStats;
}

export interface DecisionStats {
  engine: string;
  calls: number;
  /** Fraction of decisions below the automation threshold (§8.2 U5). */
  escalationRate: number;
  meanConfidence: number;
  fallbackUsed: boolean;
}

/* ------------------------------------------------------------------ */
/* Results                                                             */
/* ------------------------------------------------------------------ */

export const METRIC_KEYS = [
  "gdpGrowthPct",
  "employmentRatePct",
  "meanIncome",
  "wageIndex",
  "inflationPct",
  "happinessIndex",
  "gini",
  "protestRisk",
  "migrationOutflowPct",
] as const;
export type MetricKey = (typeof METRIC_KEYS)[number];

export interface Interval {
  p05: number;
  p50: number;
  p95: number;
}

/**
 * Aggregated uncertainty for one metric across a FIXED ENSEMBLE OF DETERMINISTIC
 * SEED RUNS (SPEC §6.8, §22).
 *
 * The seed stays the reproducibility mechanism; what changes is what is
 * DISPLAYED. Instead of one arbitrary seed's point value plus a separate range,
 * a run reports an EMPIRICAL SHARE over the seed ensemble. This is deliberately
 * NOT a probability, a confidence level or a calibrated likelihood: a finite
 * ensemble of deterministic runs does not yield a statistical probability, and
 * the field names say so (`improvedShare`, `changedShare`).
 */
export interface MetricUncertainty {
  seedCount: number;
  /** Share of seeds on which this metric improves against the no-policy baseline. */
  improvedShare: number;
  /** Share of seeds on which the metric moves materially in either direction. */
  changedShare: number;
  /** Median effect (simulated minus baseline) over the seed ensemble. */
  medianDelta: number;
  p05Delta: number;
  p95Delta: number;
}

export interface PeriodResult {
  period: number;
  month: number;
  metrics: Record<MetricKey, number>;
  /** Intensity actually applied this period after lag ramp + budget exhaustion. */
  appliedIntensity: number;
  cumulativeSpend: number;
}

export interface ValidationCheck {
  group: "population" | "network" | "aggregation" | "optimization" | "reproducibility" | "decisions";
  check: string;
  passed: boolean;
  observed: string;
  expected: string;
}

export interface GuardrailCheck {
  check: string;
  passed: boolean;
  note?: string;
  confidence?: number;
}

export interface ParetoCandidate {
  params: PolicyParams;
  objectives: Record<string, number>;
  selected: boolean;
}

export interface SimulationRequest {
  townId: string;
  policy: PolicyVector;
  /**
   * Structured policy brief. When present it is AUTHORITATIVE: the engine
   * re-runs the feasibility gate itself and takes the budget, duration and
   * channels from the brief. A brief that fails the gate throws before any
   * simulation runs, so a blocking-invalid policy cannot reach the engine even
   * if a caller bypasses the UI (spec §7, §26).
   */
  policyBrief?: PolicyBrief;
  objectives?: string[];
  mode: "single" | "optimize";
  seed: number;
  bnVersion: string;
  zoneFilter?: Zone | "all";
  /**
   * Optional external-shock stress test. The generated scenario is applied
   * IDENTICALLY to the no-policy baseline and the proposed policy, so the
   * counterfactual comparison stays causally fair (see shocks.ts).
   */
  scenario?: ShockScenarioConfig;
}

export interface TrajectoryPoint {
  month: number;
  baseline: number;
  simulated: number;
}

export interface SimulationResult {
  runId: string;
  seed: number;
  engine: { bn: string; de: string | null; decision: string };
  populationManifest: string;
  populationSize: number;
  periods: number;

  point: Record<MetricKey, number>;
  intervals: Record<MetricKey, Interval>;
  /** Empirical seed-ensemble share (NOT a probability) aggregated over the deterministic seed ensemble. */
  uncertainty: Record<MetricKey, MetricUncertainty>;
  /** Lineage this run belongs to (instrument + parameter-similarity bucket). */
  lineageKey: string;
  byZone: Record<Zone, { population: number; metrics: Record<MetricKey, Interval> }>;
  baseline: Record<MetricKey, number>;

  trajectories: Record<MetricKey, TrajectoryPoint[]>;
  distributions: {
    incomeBefore: { bucket: string; count: number }[];
    incomeAfter: { bucket: string; count: number }[];
    sentimentBefore: { label: string; count: number }[];
    sentimentAfter: { label: string; count: number }[];
  };

  paretoFront: ParetoCandidate[];
  convergence: { generation: number; best: number; mean: number; spread: number }[];
  causalAttribution: CausalFactor[];
  trajectoryTrace: PeriodResult[];

  alerts: { month: number; severity: "warning" | "danger" | "info"; metric: MetricKey; message: string }[];
  guardrails: GuardrailCheck[];
  decisionStats: DecisionStats;
  validation: ValidationCheck[];
  warnings: string[];

  /**
   * GGG historical-policy inheritance (ggg.ts). Present for every run: the
   * parents selected, the traits inherited, the Pandharpur adaptation, the
   * grounded effect scale that actually scaled the modelled policy shift, and
   * the full lineage from predecessor to simulation.
   */
  ggg?: GggInheritance;

  /**
   * Wari seasonal pressure report (redesign spec §12). Present for every run, so
   * the evaluator can see the modelled seasonal load even when the policy is not
   * a pilgrimage one; `policyCarriesPilgrimage` states whether the POLICY itself
   * contributes a pilgrimage effect.
   */
  seasonality?: SeasonalReport;

  /**
   * External-shock scenario actually applied during the run (shocks.ts). Present
   * whenever a scenario was configured; absent (or mode "none") means the run
   * used normal conditions. Reports the generated events, the arrival model and
   * the explicit confirmation that baseline and policy shared the schedule.
   */
  shocks?: ShockReport;
}

export interface SeasonalReport {
  /** True when the policy itself touches the pilgrimage channel. */
  policyCarriesPilgrimage: boolean;
  exposure: string;
  infraPolicy: string;
  startMonth: number;
  /** Mean civic pressure over the run, baseline (no policy) vs policy. */
  baselineMeanPressure: number;
  policyMeanPressure: number;
  /** Mean Wari-period pressure minus mean non-Wari pressure (the measurable step). */
  wariStep: number;
  peakPressure: number;
  points: {
    period: number;
    month: number;
    monthOfYear: number;
    season: string;
    inWari: boolean;
    baselinePressure: number;
    policyPressure: number;
  }[];
}
