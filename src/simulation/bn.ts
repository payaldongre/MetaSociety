/**
 * The Bayesian Network (SIMULATION_LAB_SPEC.md §6).
 *
 * A discrete DAG with conditional probability tables. The design follows one
 * rule: **learn from the population wherever the data can speak, and use a
 * documented prior only where it cannot.** Concretely, an agent's income class,
 * employment status, education, housing, sentiment and skill relevance are all
 * observable in the generated population, so CPTs over those variables are
 * counted directly (with Laplace smoothing). Only genuinely unobservable
 * variables — latent market demand, sector output, and the town-level bands —
 * plus the policy parameters themselves, are supplied by documented priors.
 *
 * Every table records its provenance, so the UI can show which parts of the
 * model are estimated and which are assumed.
 *
 * INFERENCE. Sampling is ancestral (forward) and exact for this system's query
 * pattern, because all evidence sits on root or near-root exogenous variables
 * (policy parameters + agent attributes). `assertEvidenceIsUpstream` enforces
 * that precondition at runtime so the engine cannot silently produce biased
 * samples.
 *
 * SCHEDULING — three passes, because town nodes depend on population totals:
 *   pass 1 (micro)    policy + agent attributes -> per-agent outcomes
 *   aggregate         population -> discretised aggregate bands
 *   pass 2 (town)     aggregate bands -> Inflation, EmploymentRate, GDP, Wages
 *   pass 3 (feedback) per-agent sentiment / protest / migration given the town
 *
 * Pass 2 feeding pass 3 is the chained causality the project dropped Random
 * Forest for: income -> spending -> demand -> inflation -> sentiment -> protest.
 */

import { createRng, toCumulative, type Rng } from "./rng";
import {
  AGE_BANDS,
  EDUCATION_LEVELS,
  EMPLOYMENT_STATUSES,
  INCOME_CLASSES,
  ENGINE_INSTRUMENTS,
  QUALITY_LEVELS,
  SECTORS,
  SENTIMENTS,
} from "./types";
import type { Bn, BnNode, CausalFactor, Cpt, EngineInstrument, Population, ValidationCheck } from "./types";

export const BN_VERSION = "1.1.0";
export const TRUST_BANDS = ["low", "medium", "high"] as const;
export const DEMAND_BANDS = ["weak", "normal", "strong"] as const;
export const EMPLOYMENT_AGG = ["low", "normal", "high"] as const;
export const MIGRATION_AGG = ["low", "normal", "high"] as const;
export const SECTOR_OUTPUT_AGG = ["declining", "stable", "rising"] as const;

/** Domain of every exogenous external-shock node ("none" means inactive). */
export const EXTERNAL_SHOCK_DOMAIN = ["none", "mild", "moderate", "severe"] as const;

/** The exogenous shock node ids, as a mutable array for the scheduler filters. */
export const EXTERNAL_SHOCK_NODE_IDS: string[] = [
  "ExternalHealthShock",
  "ExternalEconomicShock",
  "ExternalClimateShock",
  "ExternalInfrastructureShock",
  "ExternalSocialShock",
];

export const DOMAINS: Record<string, string[]> = {
  /* --- policy + exogenous roots (evidence) --- */
  PolicyType: [...ENGINE_INSTRUMENTS],
  PolicyIntensity: ["low", "medium", "high"],
  PolicyBudgetShare: ["low", "medium", "high"],
  PolicyDuration: ["short", "medium", "long"],
  IncomeClassPrior: [...INCOME_CLASSES],
  AgeBand: [...AGE_BANDS],
  EducationLevel: [...EDUCATION_LEVELS],
  HousingQuality: [...QUALITY_LEVELS],
  TrustInGov: [...TRUST_BANDS],

  /* --- aggregate bands (set deterministically from population totals) --- */
  AggregateDemand: [...DEMAND_BANDS],
  AggregateSectorOutput: [...SECTOR_OUTPUT_AGG],
  EmploymentAggregate: [...EMPLOYMENT_AGG],
  MigrationAggregate: [...MIGRATION_AGG],

  /* --- per-agent outcomes (pass 1) --- */
  SectorDemand: ["contracting", "flat", "growing"],
  IncomeClass: [...INCOME_CLASSES],
  SkillRelevance: ["obsolete", "shifting", "durable"],
  EmploymentStatus: [...EMPLOYMENT_STATUSES],
  SpendingCapacity: ["constrained", "stable", "comfortable"],
  HouseholdStress: ["low", "medium", "high"],
  SectorOfWork: [...SECTORS],
  AgentSectorOutput: ["declining", "stable", "rising"],

  /* --- healthcare channel (pass 1) — NEW, see NODE_REGISTRY --- */
  HealthInsurance: ["uninsured", "covered"],
  HealthBurden: ["low", "medium", "high"],

  /* --- town outcomes (pass 2) --- */
  Inflation: ["low", "moderate", "high"],
  EmploymentRateBand: ["low", "below_avg", "average", "above_avg", "high"],
  TownGDPGrowthBand: ["negative", "0-1", "1-2.5", "2.5-4", "above4"],
  WageLevelBand: ["falling", "flat", "modest_growth", "strong_growth", "surge"],

  /* --- feedback (pass 3) --- */
  PublicSentiment: [...SENTIMENTS],
  MigrationIntentBand: ["stay", "consider", "leave"],
  ProtestRiskBand: ["low", "medium", "high"],

  /* --- exogenous external-shock nodes (shocks.ts) --- */
  /* Always supplied as evidence, so a no-shock run draws nothing extra. */
  ExternalHealthShock: [...EXTERNAL_SHOCK_DOMAIN],
  ExternalEconomicShock: [...EXTERNAL_SHOCK_DOMAIN],
  ExternalClimateShock: [...EXTERNAL_SHOCK_DOMAIN],
  ExternalInfrastructureShock: [...EXTERNAL_SHOCK_DOMAIN],
  ExternalSocialShock: [...EXTERNAL_SHOCK_DOMAIN],
};

const PARENTS: Record<string, string[]> = {
  PolicyType: [],
  PolicyIntensity: ["PolicyType"],
  PolicyBudgetShare: ["PolicyType"],
  PolicyDuration: ["PolicyType"],
  AgeBand: [],
  IncomeClassPrior: [],
  EducationLevel: ["AgeBand"],
  HousingQuality: ["IncomeClassPrior"],
  TrustInGov: [],

  AggregateDemand: [],
  AggregateSectorOutput: [],
  EmploymentAggregate: [],
  MigrationAggregate: [],

  SectorDemand: ["PolicyType", "PolicyIntensity", "PolicyBudgetShare"],
  IncomeClass: ["IncomeClassPrior", "SectorDemand", "PolicyBudgetShare"],
  SkillRelevance: ["EducationLevel", "SectorDemand"],
  EmploymentStatus: ["IncomeClass", "SectorDemand", "PolicyType", "PolicyIntensity"],
  SpendingCapacity: ["IncomeClass", "EmploymentStatus", "PolicyBudgetShare"],
  HouseholdStress: ["IncomeClass", "EmploymentStatus", "SpendingCapacity", "HousingQuality"],
  SectorOfWork: ["SectorDemand", "EducationLevel", "IncomeClass", "SkillRelevance"],
  AgentSectorOutput: ["SectorDemand", "EmploymentStatus", "SkillRelevance"],

  HealthInsurance: ["IncomeClass", "EmploymentStatus"],
  HealthBurden: ["HealthInsurance", "IncomeClass", "SpendingCapacity"],

  Inflation: ["AggregateDemand", "PolicyBudgetShare", "PolicyType"],
  EmploymentRateBand: ["EmploymentAggregate", "MigrationAggregate"],
  TownGDPGrowthBand: ["AggregateSectorOutput", "EmploymentRateBand", "Inflation"],
  WageLevelBand: ["TownGDPGrowthBand", "EmploymentRateBand", "Inflation"],

  PublicSentiment: ["IncomeClass", "EmploymentStatus", "Inflation", "TrustInGov", "PolicyType"],
  MigrationIntentBand: ["EmploymentStatus", "SkillRelevance", "PublicSentiment", "AgeBand"],
  ProtestRiskBand: ["PublicSentiment", "TrustInGov", "HouseholdStress", "PolicyType"],
};

const POLICY_NODE_IDS = ["PolicyType", "PolicyIntensity", "PolicyBudgetShare", "PolicyDuration"];

/**
 * Which policy dimensions each node's shift actually reads.
 *
 * `policyLogShift` scales every instrument by policy type, intensity AND budget
 * share, so a node that carries a shift must condition on all three of them.
 * Declaring that here (rather than hand-listing parents per node, which is how
 * the four policy nodes drifted out of sync) guarantees the two can never
 * disagree: a node's table always has a row for the exact policy configuration
 * the simulator applies, and no policy dimension is silently held at
 * `undefined` — which the shift would read as "low".
 */
const POLICY_SHIFT_DIMS: Record<string, string[]> = {
  SectorDemand: ["PolicyType", "PolicyIntensity", "PolicyBudgetShare"],
  IncomeClass: ["PolicyType", "PolicyIntensity", "PolicyBudgetShare"],
  EmploymentStatus: ["PolicyType", "PolicyIntensity", "PolicyBudgetShare"],
  SpendingCapacity: ["PolicyType", "PolicyIntensity", "PolicyBudgetShare"],
  Inflation: ["PolicyType", "PolicyIntensity", "PolicyBudgetShare"],
  PublicSentiment: ["PolicyType", "PolicyIntensity", "PolicyBudgetShare"],
  ProtestRiskBand: ["PolicyType", "PolicyIntensity", "PolicyBudgetShare"],
  HealthInsurance: ["PolicyType", "PolicyIntensity", "PolicyBudgetShare"],
  HealthBurden: ["PolicyType", "PolicyIntensity", "PolicyBudgetShare"],
};

/**
 * Which exogenous shock nodes each downstream node conditions on. A shock node
 * is a ROOT supplied as evidence for the period(s) its event is active; when it
 * reads "none" the row shift is exactly zero, so a no-shock run is unchanged.
 * Declaring the edges here (rather than editing each node by hand) is what makes
 * a shock a data change rather than an engine change.
 */
const SHOCK_DIMS: Record<string, string[]> = {
  SectorDemand: ["ExternalEconomicShock", "ExternalClimateShock"],
  IncomeClass: ["ExternalEconomicShock"],
  EmploymentStatus: ["ExternalEconomicShock", "ExternalHealthShock"],
  SpendingCapacity: ["ExternalEconomicShock", "ExternalHealthShock"],
  HouseholdStress: ["ExternalClimateShock", "ExternalInfrastructureShock"],
  HealthBurden: ["ExternalHealthShock", "ExternalClimateShock"],
  ProtestRiskBand: ["ExternalSocialShock"],
  MigrationIntentBand: ["ExternalSocialShock"],
};

/**
 * Documented additive log-weight shifts from an exogenous shock node, indexed
 * by the shock node's severity state (none | mild | moderate | severe) and then
 * the child's own state. Every entry is a MODEL ASSUMPTION: only the direction
 * is asserted (a worse shock pushes the child toward its worse states); the
 * magnitudes are bounded and are not calibrated to any observed event.
 */
export const EXTERNAL_SHIFT: Record<string, Record<string, number[][]>> = {
  SectorDemand: {
    ExternalEconomicShock: [
      [0, 0, 0],
      [0.35, 0, -0.25],
      [0.75, 0, -0.5],
      [1.2, 0, -0.85],
    ],
    ExternalClimateShock: [
      [0, 0, 0],
      [0.3, 0, -0.15],
      [0.55, 0, -0.3],
      [0.9, 0, -0.55],
    ],
  },
  IncomeClass: {
    ExternalEconomicShock: [
      [0, 0, 0, 0, 0, 0],
      [0.3, 0.15, 0, -0.15, -0.2, -0.2],
      [0.6, 0.3, 0, -0.3, -0.4, -0.45],
      [1.0, 0.5, 0, -0.5, -0.7, -0.8],
    ],
  },
  EmploymentStatus: {
    ExternalEconomicShock: [
      [0, 0, 0],
      [0.45, 0.1, -0.4],
      [0.85, 0.15, -0.7],
      [1.3, 0.2, -1.0],
    ],
    ExternalHealthShock: [
      [0, 0, 0],
      [0.25, 0.05, -0.2],
      [0.5, 0.08, -0.4],
      [0.85, 0.12, -0.65],
    ],
  },
  SpendingCapacity: {
    ExternalEconomicShock: [
      [0, 0, 0],
      [0.3, 0, -0.25],
      [0.6, 0, -0.5],
      [1.0, 0, -0.8],
    ],
    ExternalHealthShock: [
      [0, 0, 0],
      [0.3, 0, -0.25],
      [0.55, 0, -0.45],
      [0.9, 0, -0.7],
    ],
  },
  HouseholdStress: {
    ExternalClimateShock: [
      [0, 0, 0],
      [-0.3, 0, 0.3],
      [-0.6, 0, 0.6],
      [-0.9, 0, 0.9],
    ],
    ExternalInfrastructureShock: [
      [0, 0, 0],
      [-0.25, 0, 0.25],
      [-0.5, 0, 0.5],
      [-0.8, 0, 0.8],
    ],
  },
  HealthBurden: {
    ExternalHealthShock: [
      [0, 0, 0],
      [-0.35, 0, 0.35],
      [-0.7, 0, 0.7],
      [-1.1, 0, 1.1],
    ],
    ExternalClimateShock: [
      [0, 0, 0],
      [-0.2, 0, 0.2],
      [-0.4, 0, 0.4],
      [-0.7, 0, 0.7],
    ],
  },
  ProtestRiskBand: {
    ExternalSocialShock: [
      [0, 0, 0],
      [-0.3, 0, 0.3],
      [-0.6, 0, 0.6],
      [-0.95, 0, 0.95],
    ],
  },
  MigrationIntentBand: {
    ExternalSocialShock: [
      [0, 0, 0],
      [-0.25, 0, 0.25],
      [-0.5, 0, 0.5],
      [-0.8, 0, 0.8],
    ],
  },
};

/**
 * The scheduling pass each node belongs to. The three-pass scheduler walks the
 * registry by this field instead of calling hardcoded named functions.
 *
 *   micro    roots + per-agent outcomes      (pass 1)
 *   town     aggregate-band outcomes         (pass 2)
 *   feedback per-agent sentiment / protest / migration given the town (pass 3)
 */
const NODE_PASS: Record<string, "micro" | "town" | "feedback"> = {
  /* roots and per-agent outcomes */
  PolicyType: "micro",
  PolicyIntensity: "micro",
  PolicyBudgetShare: "micro",
  PolicyDuration: "micro",
  IncomeClassPrior: "micro",
  AgeBand: "micro",
  EducationLevel: "micro",
  HousingQuality: "micro",
  TrustInGov: "micro",
  SectorDemand: "micro",
  IncomeClass: "micro",
  SkillRelevance: "micro",
  EmploymentStatus: "micro",
  SpendingCapacity: "micro",
  HouseholdStress: "micro",
  SectorOfWork: "micro",
  AgentSectorOutput: "micro",
  HealthInsurance: "micro",
  HealthBurden: "micro",
  /* aggregate bands (set deterministically by the aggregation step) */
  AggregateDemand: "micro",
  AggregateSectorOutput: "micro",
  EmploymentAggregate: "micro",
  MigrationAggregate: "micro",
  /* exogenous external-shock roots (shocks.ts) — always supplied as evidence */
  ExternalHealthShock: "micro",
  ExternalEconomicShock: "micro",
  ExternalClimateShock: "micro",
  ExternalInfrastructureShock: "micro",
  ExternalSocialShock: "micro",
  /* town */
  Inflation: "town",
  EmploymentRateBand: "town",
  TownGDPGrowthBand: "town",
  WageLevelBand: "town",
  /* feedback */
  PublicSentiment: "feedback",
  MigrationIntentBand: "feedback",
  ProtestRiskBand: "feedback",
};

/**
 * Where a node's conditional probability comes from.
 *
 *   observed  counted from the population data (with Laplace smoothing)
 *   prior     a documented prior, because the variable is not observably
 *   derived   an aggregate band set deterministically by the aggregation step
 *
 * Every `prior` entry is a MODELLED ASSUMPTION and is flagged as such in the
 * provenance ledger, exactly like the existing `modelled` fields.
 */
const NODE_CPT_SOURCE: Record<string, "observed" | "prior" | "derived"> = {
  PolicyType: "prior",
  PolicyIntensity: "prior",
  PolicyBudgetShare: "prior",
  PolicyDuration: "prior",
  IncomeClassPrior: "observed",
  AgeBand: "observed",
  EducationLevel: "observed",
  HousingQuality: "observed",
  TrustInGov: "observed",
  SectorDemand: "prior",
  IncomeClass: "observed",
  SkillRelevance: "observed",
  EmploymentStatus: "observed",
  SpendingCapacity: "observed",
  HouseholdStress: "observed",
  SectorOfWork: "observed",
  AgentSectorOutput: "observed",
  HealthInsurance: "observed",
  HealthBurden: "observed",
  AggregateDemand: "derived",
  AggregateSectorOutput: "derived",
  EmploymentAggregate: "derived",
  MigrationAggregate: "derived",
  Inflation: "prior",
  EmploymentRateBand: "prior",
  TownGDPGrowthBand: "prior",
  WageLevelBand: "prior",
  PublicSentiment: "observed",
  MigrationIntentBand: "observed",
  ProtestRiskBand: "observed",
  ExternalHealthShock: "prior",
  ExternalEconomicShock: "prior",
  ExternalClimateShock: "prior",
  ExternalInfrastructureShock: "prior",
  ExternalSocialShock: "prior",
};

/**
 * The declarative node registry: the single source the three-pass scheduler
 * walks. Adding a node is a data change here (plus, where it is unobservable, a
 * documented prior), not a hand-edit of the engine's named functions.
 */
/**
 * How a node's conditional structure was obtained. Kept distinct so the UI and
 * documentation can tell a measured relationship (observed) from a documented
 * model assumption (assumed), rather than presenting them the same way.
 */
export type NodeCalibration = "observed" | "derived" | "assumed" | "historical_evidence";

export interface NodeSpec {
  id: string;
  domain: string[];
  parents: string[];
  pass: "micro" | "town" | "feedback";
  /** No parents: drawn before the micro pass. */
  root: boolean;
  cptSource: "observed" | "prior" | "derived";
  /** True when the conditional structure is a flagged modelling assumption. */
  modelled: boolean;
  /** Registered after the original network; scheduled from an isolated stream. */
  extension: boolean;
  /** Observed / derived / assumed, so the provenance is machine-readable. */
  calibration: NodeCalibration;
  /** Human-readable provenance of this node's conditional table. */
  provenance: string;
}

/**
 * Nodes whose conditional structure is a MODELLED ASSUMPTION rather than a
 * measured relationship. HealthBurden is derived from coverage + income + a
 * savings proxy, the same way HouseholdStress is derived, and is flagged here so
 * it is never presented as measured.
 */
const MODELLED_NODES = new Set<string>(["HealthBurden"]);

/**
 * Nodes registered after the original 29-node network.
 *
 * They are scheduled from an ISOLATED random stream (see `samplePass`) so that
 * adding a node can never silently rewrite the established simulation: the
 * pre-existing nodes keep drawing the exact uniforms they always did, and a new
 * node's conditional structure can be reviewed without perturbing history.
 */
const EXTENSION_NODES = new Set<string>(["HealthInsurance", "HealthBurden"]);

/**
 * Explicit scheduling order. The micro order is the ORIGINAL order the engine
 * used, so established results are preserved; newly registered nodes are
 * appended at the end and drawn from the isolated stream. Town and feedback
 * orders match the original lists.
 */
const MICRO_SCHEDULE_ORDER = [
  "SectorDemand",
  "SkillRelevance",
  "IncomeClass",
  "EmploymentStatus",
  "SpendingCapacity",
  "HouseholdStress",
  "SectorOfWork",
  "AgentSectorOutput",
  "HealthInsurance",
  "HealthBurden",
];

const PASS_SCHEDULE: Record<"micro" | "town" | "feedback", string[]> = {
  micro: MICRO_SCHEDULE_ORDER,
  town: ["Inflation", "EmploymentRateBand", "TownGDPGrowthBand", "WageLevelBand"],
  feedback: ["PublicSentiment", "MigrationIntentBand", "ProtestRiskBand"],
};

/** Observed from the population, derived (an aggregate band), or assumed. */
function calibrationFor(id: string, cptSource: NodeSpec["cptSource"], modelled: boolean): NodeCalibration {
  if (cptSource === "observed") return "observed";
  if (cptSource === "derived") return "derived";
  if (modelled) return "assumed";
  return "assumed";
}

function provenanceFor(id: string, cptSource: NodeSpec["cptSource"], modelled: boolean): string {
  if (cptSource === "observed") return "estimated_from_population";
  if (cptSource === "derived") return "derived_from_aggregation";
  return modelled ? "prior:assumption (flagged model assumption)" : "prior:assumption";
}

export const NODE_REGISTRY: NodeSpec[] = Object.keys(DOMAINS).map((id) => {
  const parents = policyParentsFor(id);
  const cptSource = NODE_CPT_SOURCE[id] ?? "prior";
  const modelled = MODELLED_NODES.has(id) || EXTERNAL_SHOCK_NODE_IDS.includes(id);
  return {
    id,
    domain: DOMAINS[id],
    parents,
    pass: NODE_PASS[id] ?? "micro",
    root: parents.length === 0,
    cptSource,
    modelled,
    extension: EXTENSION_NODES.has(id),
    calibration: calibrationFor(id, cptSource, modelled),
    provenance: provenanceFor(id, cptSource, modelled),
  };
});

/** Effective policy configuration for a table row, incl. the shift's dimensions. */
function policyParentsFor(id: string): string[] {
  const declared = PARENTS[id] ?? [];
  const policyExtra = (POLICY_SHIFT_DIMS[id] ?? []).filter((p) => !declared.includes(p));
  const shockExtra = (SHOCK_DIMS[id] ?? []).filter(
    (p) => !declared.includes(p) && !policyExtra.includes(p),
  );
  return [...declared, ...policyExtra, ...shockExtra];
}

/**
 * The three scheduling lists are DERIVED from the registry, so a node cannot
 * drift out of the scheduler by being added to one list and not another.
 * Roots are sampled before the micro pass (see `samplePass`).
 */
export const MICRO_NODES = MICRO_SCHEDULE_ORDER.filter((id) => !EXTENSION_NODES.has(id));

export const TOWN_NODES = NODE_REGISTRY.filter((n) => n.pass === "town").map((n) => n.id);

export const FEEDBACK_NODES = NODE_REGISTRY.filter((n) => n.pass === "feedback").map((n) => n.id);

export const AGGREGATE_NODES = ["AggregateDemand", "AggregateSectorOutput", "EmploymentAggregate", "MigrationAggregate"];

/** Nodes with no parents: policy parameters and agent attributes. */
export const ROOT_NODE_IDS = NODE_REGISTRY.filter((n) => n.root).map((n) => n.id);

/**
 * Documented additive log-weight shifts applied on top of the learned base
 * table, indexed by [parent state][child state]. Used ONLY for parent variables
 * that are not observable in the population (latent demand, sector output, and
 * the aggregate bands). Magnitudes are deliberately modest; the point is to
 * encode direction and rough strength, which §6.6 then asserts.
 *
 * Every entry here is a MODELLED ASSUMPTION.
 */
const LATENT_SHIFTS: Record<string, number[][]> = {
  /* --- policy-free demand shifts --- */
  "IncomeClass|SectorDemand": [
    [0.45, 0.3, 0.05, -0.2, -0.35, -0.4], // contracting
    [0, 0, 0, 0, 0, 0], // flat
    [-0.3, -0.2, 0, 0.15, 0.3, 0.35], // growing
  ],
  "EmploymentStatus|SectorDemand": [
    [0.6, 0.15, -0.5],
    [0, 0, 0],
    [-0.5, -0.05, 0.45],
  ],
  "SkillRelevance|SectorDemand": [
    [0.35, 0, -0.25],
    [0, 0, 0],
    [-0.3, 0, 0.3],
  ],
  "SectorOfWork|SectorDemand": [
    [0.25, -0.2, -0.15, 0.05, -0.35, -0.2, 0.2, 0.35],
    [0, 0, 0, 0, 0, 0, 0, 0],
    [-0.15, 0.25, 0.2, 0.05, 0.35, 0.25, 0.05, -0.3],
  ],
  "AgentSectorOutput|SectorDemand": [
    [0.9, 0, -0.7],
    [0, 0, 0],
    [-0.8, 0, 0.8],
  ],

  /* --- town-level shifts --- */
  "Inflation|AggregateDemand": [
    [0.5, 0, -0.6],
    [0, 0, 0],
    [-0.7, 0, 0.7],
  ],
  "EmploymentRateBand|EmploymentAggregate": [
    [0.9, 0.6, 0, -0.6, -0.9],
    [0, 0, 0, 0, 0],
    [-0.9, -0.5, 0, 0.5, 0.9],
  ],
  "EmploymentRateBand|MigrationAggregate": [
    [0, 0, 0, 0, 0],
    [0.3, 0.2, 0, -0.15, -0.3],
    [0.8, 0.4, 0, -0.3, -0.7],
  ],
  "TownGDPGrowthBand|AggregateSectorOutput": [
    [0.9, 0.5, 0, -0.7, -1.0],
    [0, 0, 0, 0, 0],
    [-1.0, -0.5, 0, 0.6, 0.9],
  ],
  "TownGDPGrowthBand|EmploymentRateBand": [
    [0.5, 0.4, 0, -0.4, -0.6],
    [0.25, 0.2, 0, -0.2, -0.3],
    [0, 0, 0, 0, 0],
    [-0.2, -0.15, 0, 0.2, 0.25],
    [-0.4, -0.3, 0, 0.35, 0.5],
  ],
  "TownGDPGrowthBand|Inflation": [
    [-0.1, -0.05, 0, 0, 0],
    [0, 0, 0, 0, 0],
    [0.2, 0.15, 0, -0.2, -0.25],
  ],
  "WageLevelBand|TownGDPGrowthBand": [
    [0.9, 0.5, 0, -0.6, -0.9],
    [0.4, 0.35, 0, -0.3, -0.5],
    [0, 0, 0, 0, 0],
    [-0.3, -0.2, 0, 0.3, 0.4],
    [-0.6, -0.4, 0, 0.6, 0.9],
  ],
  "WageLevelBand|EmploymentRateBand": [
    [0.5, 0.4, 0, -0.4, -0.5],
    [0.25, 0.2, 0, -0.2, -0.25],
    [0, 0, 0, 0, 0],
    [-0.2, -0.15, 0, 0.2, 0.25],
    [-0.4, -0.3, 0, 0.35, 0.45],
  ],
  "WageLevelBand|Inflation": [
    [-0.1, -0.05, 0, 0, 0.05],
    [0, 0, 0, 0, 0],
    [0.35, 0.25, 0, -0.25, -0.35],
  ],

  /* --- feedback shifts --- */
  "PublicSentiment|Inflation": [
    [0, 0, 0.2],
    [0, 0, 0],
    [0.35, 0, -0.3],
  ],
  "MigrationIntentBand|PublicSentiment": [
    [-0.4, 0, 0.5],
    [0, 0, 0],
    [0.35, 0, -0.45],
  ],
  "ProtestRiskBand|PublicSentiment": [
    [-0.5, 0, 0.7],
    [0, 0, 0],
    [0.5, 0, -0.5],
  ],
  "ProtestRiskBand|HouseholdStress": [
    [0.35, 0, -0.35],
    [0, 0, 0],
    [-0.4, 0, 0.5],
  ],
};

/** Child-state meaning decoder, documented once for the table above. */
export const DOMAIN_LEGENDS: Record<string, string> = {
  SectorDemand: "contracting | flat | growing",
  IncomeClass: INCOME_CLASSES.join(" | "),
  SkillRelevance: "obsolete | shifting | durable",
  EmploymentStatus: EMPLOYMENT_STATUSES.join(" | "),
  SpendingCapacity: "constrained | stable | comfortable",
  HouseholdStress: "low | medium | high",
  SectorOfWork: SECTORS.join(" | "),
  AgentSectorOutput: "declining | stable | rising",
  PublicSentiment: SENTIMENTS.join(" | "),
  MigrationIntentBand: "stay | consider | leave",
  ProtestRiskBand: "low | medium | high",
  HealthInsurance: "uninsured | covered",
  HealthBurden: "low | medium | high",
};

/**
 * Policy effects: additive log-weights scaled by intensity and budget share.
 * These are the documented, checkable directions of each instrument.
 */
function policyLogShift(
  nodeId: string,
  policy: Record<string, string>,
  groundedStrength = 1,
): number[] | null {
  const type = (policy.PolicyType ?? "none") as EngineInstrument;
  // An unspecified dimension falls back to the reference (medium) scaling, not
  // the minimum: "not stated" must never be read as "weakest possible policy".
  const intensityScale =
    policy.PolicyIntensity === "high" ? 1 : policy.PolicyIntensity === "low" ? 0.35 : 0.65;
  const budgetScale =
    policy.PolicyBudgetShare === "high" ? 1 : policy.PolicyBudgetShare === "low" ? 0.3 : 0.6;
  // GGG's CONTINUOUS grounded effect scale (ggg.ts). This is the fix for the
  // information-loss defect: instead of banding the grounded value down to
  // low/medium/high (which collapsed materially different grounded policies onto
  // the same BN state), the grounded value multiplies the policy's causal
  // log-shift directly, so two grounded strengths that differ by any amount
  // produce two different conditional distributions. The multiplier is bounded
  // to [0,1]; it is a stated model assumption (the grounded effect scale), not
  // an empirical coefficient.
  const grounding = Math.max(0, Math.min(1, groundedStrength));
  const s = intensityScale * budgetScale * grounding;

  switch (nodeId) {
    case "SectorDemand":
      switch (type) {
        case "subsidy":
          return [0.4 * s, 0, 1.0 * s];
        case "tax":
          return [0.9 * s, 0, -0.7 * s];
        case "housing":
          return [0.2 * s, 0, 0.55 * s];
        case "labor":
          return [0.3 * s, 0, 0.8 * s];
        case "education":
          return [0.15 * s, 0, 0.35 * s];
        case "regulation":
          return [0.5 * s, 0, -0.2 * s];
        default:
          return null;
      }
    case "IncomeClass":
      switch (type) {
        case "subsidy":
          return [0.5 * s, 0.25 * s, -0.1 * s, -0.25 * s, -0.3 * s, -0.3 * s];
        case "tax":
          return [0.2 * s, 0.15 * s, 0.05 * s, -0.1 * s, -0.25 * s, -0.3 * s];
        case "education":
          return [0, 0, 0.05 * s, 0.1 * s, 0.12 * s, 0.1 * s];
        case "housing":
          return [0.3 * s, 0.2 * s, 0, -0.15 * s, -0.2 * s, -0.2 * s];
        case "health":
          // Financial protection: coverage shields the bottom of the distribution
          // from medical-cost shocks. Distinct magnitudes from `subsidy`.
          return [0.25 * s, 0.18 * s, 0, -0.08 * s, -0.15 * s, -0.15 * s];
        default:
          return null;
      }
    case "EmploymentStatus":
      switch (type) {
        case "subsidy":
          return [-1.0 * s, -0.1 * s, 0.7 * s];
        case "labor":
          return [-1.2 * s, -0.15 * s, 0.85 * s];
        case "education":
          return [-0.55 * s, -0.35 * s, 0.7 * s];
        case "tax":
          return [0.5 * s, 0.35 * s, -0.5 * s];
        case "regulation":
          return [0.35 * s, 0.5 * s, -0.5 * s];
        case "housing":
          return [-0.3 * s, -0.1 * s, 0.2 * s];
        case "health":
          // Health shocks keep workers out of work; coverage supports formal work.
          return [-0.25 * s, -0.08 * s, 0.3 * s];
        default:
          return null;
      }
    case "SpendingCapacity":
      switch (type) {
        case "subsidy":
          return [-0.7 * s, 0, 0.6 * s];
        case "tax":
          return [0.75 * s, 0, -0.4 * s];
        case "housing":
          return [-0.35 * s, 0, 0.3 * s];
        case "health":
          // Out-of-pocket medical cost is a spending-capacity shock; coverage
          // relieves it. A distinct channel from subsidies.
          return [-0.55 * s, 0, 0.55 * s];
        default:
          return null;
      }
    case "Inflation":
      switch (type) {
        case "subsidy":
        case "labor":
          return [-0.4 * s, 0, 0.75 * s];
        case "housing":
          return [-0.2 * s, 0, 0.45 * s];
        case "tax":
          return [0.35 * s, 0, -0.3 * s];
        default:
          return null;
      }
    case "PublicSentiment":
      switch (type) {
        case "subsidy":
        case "labor":
          return [-0.55 * s, 0, 0.65 * s];
        case "housing":
          return [-0.6 * s, 0, 0.7 * s];
        case "education":
          return [-0.25 * s, 0, 0.35 * s];
        case "tax":
          return [0.5 * s, 0, -0.45 * s];
        case "regulation":
          return [0.4 * s, 0, -0.3 * s];
        case "health":
          // Visible coverage is experienced sentiment, not a transfer.
          return [-0.35 * s, 0, 0.5 * s];
        default:
          return null;
      }
    case "ProtestRiskBand":
      switch (type) {
        case "tax":
        case "regulation":
          return [-0.4 * s, 0, 0.6 * s];
        case "subsidy":
        case "housing":
          return [0.5 * s, 0, -0.45 * s];
        case "health":
          return [0.45 * s, 0, -0.42 * s];
        default:
          return null;
      }
    /*
     * Healthcare / insurance — a GENUINELY NEW channel. It deliberately does
     * NOT fall through to the generic subsidy shift on SectorDemand /
     * IncomeClass / EmploymentStatus (that was the bug: a run labelled
     * "Health insurance" produced a pure intensity-scaled subsidy response). A
     * health policy moves coverage and burden only.
     */
    case "HealthInsurance":
      switch (type) {
        case "health":
          return [-0.6 * s, 0.85 * s]; // favour "covered"
        default:
          return null;
      }
    case "HealthBurden":
      switch (type) {
        case "health":
          return [0.7 * s, 0, -0.85 * s]; // favour "low"
        default:
          return null;
      }
    default:
      return null;
  }
}

/* ------------------------------------------------------------------ */
/* Observability                                                       */
/* ------------------------------------------------------------------ */

/** Population-derived state for a node, or -1 when the population cannot inform it. */
export function observedStateFor(pop: Population, i: number, nodeId: string): number {
  switch (nodeId) {
    case "IncomeClassPrior":
    case "IncomeClass":
      return pop.incomeClass[i];
    case "AgeBand":
      return pop.ageBand[i];
    case "EducationLevel":
      return pop.education[i];
    case "HousingQuality":
      return pop.housing[i];
    case "TrustInGov":
      return pop.trustInGov[i] < 0.36 ? 0 : pop.trustInGov[i] < 0.6 ? 1 : 2;
    case "SkillRelevance":
      return pop.skillRelevance[i] < 0.45 ? 0 : pop.skillRelevance[i] < 0.72 ? 1 : 2;
    case "EmploymentStatus":
      return pop.employmentStatus[i];
    case "SpendingCapacity":
      return pop.savingsMonths[i] < 1.5 ? 0 : pop.savingsMonths[i] < 5 ? 1 : 2;
    case "HouseholdStress": {
      const poor = pop.incomeClass[i] <= 1;
      const jobless = pop.employmentStatus[i] === 0;
      const poorHousing = pop.housing[i] === 0;
      const score = (poor ? 1 : 0) + (jobless ? 1 : 0) + (poorHousing ? 1 : 0);
      return score >= 2 ? 2 : score === 1 ? 1 : 0;
    }
    case "HealthInsurance":
      return pop.healthInsurance[i] === 1 ? 1 : 0;
    case "HealthBurden": {
      // MODELLED ASSUMPTION (ledger: modelled). Out-of-pocket burden derived
      // from coverage, income class and the savings stock — the same derivation
      // style as HouseholdStress, and flagged rather than presented as measured.
      const covered = pop.healthInsurance[i] === 1;
      const poor = pop.incomeClass[i] <= 1;
      const fragile = pop.savingsMonths[i] < 1.5;
      const score = (covered ? 0 : 1) + (poor ? 1 : 0) + (fragile ? 1 : 0);
      return score >= 2 ? 2 : score === 1 ? 1 : 0;
    }
    case "SectorOfWork":
      return pop.sector[i];
    case "PublicSentiment":
      return pop.sentiment[i];
    case "MigrationIntentBand":
      return pop.migrationIntent[i] < 0.2 ? 0 : pop.migrationIntent[i] < 0.48 ? 1 : 2;
    case "ProtestRiskBand":
      return pop.protestPropensity[i] < 0.12 ? 0 : pop.protestPropensity[i] < 0.3 ? 1 : 2;
    default:
      return -1;
  }
}

/* ------------------------------------------------------------------ */
/* CPT construction                                                    */
/* ------------------------------------------------------------------ */

const ALPHA = 1; // Dirichlet smoothing — keeps evidence from becoming impossible

function uniform(n: number): number[] {
  return new Array(n).fill(1 / n);
}

const PRIORS: Record<string, { dist: number[]; source: string }> = {
  PolicyType: { dist: uniform(ENGINE_INSTRUMENTS.length), source: "prior:assumption" },
  PolicyIntensity: { dist: uniform(3), source: "prior:assumption" },
  PolicyBudgetShare: { dist: uniform(3), source: "prior:assumption" },
  PolicyDuration: { dist: uniform(3), source: "prior:assumption" },
  AggregateDemand: { dist: uniform(3), source: "derived_from_aggregation" },
  AggregateSectorOutput: { dist: uniform(3), source: "derived_from_aggregation" },
  EmploymentAggregate: { dist: uniform(3), source: "derived_from_aggregation" },
  MigrationAggregate: { dist: uniform(3), source: "derived_from_aggregation" },
  SectorDemand: { dist: [0.34, 0.4, 0.26], source: "prior:assumption" },
  AgentSectorOutput: { dist: [0.28, 0.48, 0.24], source: "prior:assumption" },
  Inflation: { dist: [0.34, 0.44, 0.22], source: "prior:assumption" },
  EmploymentRateBand: { dist: [0.12, 0.22, 0.34, 0.22, 0.1], source: "prior:assumption" },
  TownGDPGrowthBand: { dist: [0.08, 0.24, 0.38, 0.22, 0.08], source: "prior:assumption" },
  WageLevelBand: { dist: [0.1, 0.3, 0.34, 0.2, 0.06], source: "prior:assumption" },
  // Exogenous shock roots default to "none": an un-fixed draw can only ever be
  // "none", so a run that supplies no shock evidence behaves exactly as before.
  ExternalHealthShock: { dist: [1, 0, 0, 0], source: "prior:assumption" },
  ExternalEconomicShock: { dist: [1, 0, 0, 0], source: "prior:assumption" },
  ExternalClimateShock: { dist: [1, 0, 0, 0], source: "prior:assumption" },
  ExternalInfrastructureShock: { dist: [1, 0, 0, 0], source: "prior:assumption" },
  ExternalSocialShock: { dist: [1, 0, 0, 0], source: "prior:assumption" },
};

function keyFor(states: number[]): string {
  return states.join("|");
}

function comboStates(c: number, sizes: number[]): number[] {
  const out: number[] = new Array(sizes.length);
  let rem = c;
  for (let k = sizes.length - 1; k >= 0; k -= 1) {
    out[k] = rem % sizes[k];
    rem = Math.floor(rem / sizes[k]);
  }
  return out;
}

/**
 * Build the network. CPTs are counted from the population for every node with
 * at least one observable parent; documented prior shifts then reweight the
 * rows for the unobservable parents. Nodes with no observable parent use a
 * documented prior distribution.
 */
/**
 * Build-time context the declarative node registry reads. The only entry today
 * is GGG's continuous grounded effect scale, which is baked into the policy
 * log-shifts when the network is built. Passing it at BUILD time (rather than
 * as another discrete evidence node) is deliberate: it keeps the grounded value
 * at full resolution instead of quantising it into bands.
 */
export interface BnContext {
  /** GGG grounded effect scale in (0,1]; 1 is the fully-grounded reference. */
  groundedStrength: number;
}

export const DEFAULT_BN_CONTEXT: BnContext = { groundedStrength: 1 };

export function buildBn(pop: Population, context: BnContext = DEFAULT_BN_CONTEXT): Bn {
  const nodes: Record<string, BnNode> = {};
  for (const id of Object.keys(DOMAINS)) {
    const parents = policyParentsFor(id);
    nodes[id] = {
      id,
      domain: DOMAINS[id],
      parents,
      kind: parents.length === 0 ? "root" : "micro",
    };
  }

  const cpts: Record<string, Cpt> = {};

  for (const id of Object.keys(nodes)) {
    const domain = nodes[id].domain;
    const domainN = domain.length;
    const parents = nodes[id].parents;
    const shockParents = parents.filter((p) => EXTERNAL_SHOCK_NODE_IDS.includes(p));
    const latentParents = parents.filter(
      (p) =>
        !POLICY_NODE_IDS.includes(p) &&
        !EXTERNAL_SHOCK_NODE_IDS.includes(p) &&
        pop.size > 0 &&
        observedStateFor(pop, 0, p) < 0,
    );
    const observableParents = parents.filter(
      (p) =>
        !POLICY_NODE_IDS.includes(p) &&
        !EXTERNAL_SHOCK_NODE_IDS.includes(p) &&
        !latentParents.includes(p) &&
        pop.size > 0 &&
        observedStateFor(pop, 0, p) >= 0,
    );
    const policyParents = parents.filter((p) => POLICY_NODE_IDS.includes(p));

    /* --- base table over the observable parents, counted from the population --- */
    const base: Record<string, number[]> = {};
    if (observableParents.length > 0) {
      for (let i = 0; i < pop.size; i += 1) {
        const child = observedStateFor(pop, i, id);
        if (child < 0) continue;
        const pStates = observableParents.map((p) => {
          const st = observedStateFor(pop, i, p);
          return st < 0 ? 0 : st;
        });
        const k = keyFor(pStates);
        if (!base[k]) base[k] = new Array(domainN).fill(ALPHA);
        base[k][child] += 1;
      }
    }

    /* --- population marginal over the child, used to fill unseen rows --- */
    const marginalCounts = new Array(domainN).fill(ALPHA);
    let marginalFromData = false;
    for (let i = 0; i < pop.size; i += 1) {
      const child = observedStateFor(pop, i, id);
      if (child < 0) continue;
      marginalCounts[child] += 1;
      marginalFromData = true;
    }

    const hasObservableData = marginalFromData && Object.keys(base).length > 0;
    const prior = PRIORS[id] ?? { dist: uniform(domainN), source: "prior:assumption" };

    let marginal: number[];
    if (marginalFromData) {
      const sum = marginalCounts.reduce((a, b) => a + b, 0);
      marginal = marginalCounts.map((v) => v / sum);
    } else {
      marginal = prior.dist.slice();
    }

    /* --- full table over all parents: base x documented shifts --- */
    const comboCount = parents.reduce((acc, p) => acc * DOMAINS[p].length, 1);
    const table: Record<string, number[]> = {};

    for (let c = 0; c < comboCount; c += 1) {
      const fullStates = comboStates(
        c,
        parents.map((p) => DOMAINS[p].length),
      );

      let baseDist: number[];
      if (hasObservableData) {
        const obsKey = keyFor(observableParents.map((p) => fullStates[parents.indexOf(p)]));
        baseDist = base[obsKey] ?? marginal;
      } else {
        baseDist = prior.dist;
      }
      const baseSum = baseDist.reduce((a, b) => a + b, 0) || 1;
      let dist = baseDist.map((v) => v / baseSum);

      // Documented shifts from unobservable parents.
      for (const p of latentParents) {
        const shift = LATENT_SHIFTS[`${id}|${p}`];
        if (!shift) continue;
        const row = shift[fullStates[parents.indexOf(p)]];
        if (!row) continue;
        dist = dist.map((v, k) => v * Math.exp(row[k] ?? 0));
      }

      // Documented external-shock interventions (shocks.ts). A shock node reads
      // "none" when no event is active, and the "none" row shift is exactly zero,
      // so a no-shock run is byte-identical to one without this dimension.
      for (const p of shockParents) {
        const byShock = EXTERNAL_SHIFT[id]?.[p];
        if (!byShock) continue;
        const row = byShock[fullStates[parents.indexOf(p)]];
        if (!row) continue;
        dist = dist.map((v, k) => v * Math.exp(row[k] ?? 0));
      }

      // Documented policy effects, scaled by intensity, budget share AND GGG's
      // continuous grounded strength.
      if (policyParents.length > 0) {
        const policy: Record<string, string> = {};
        for (const p of policyParents) policy[p] = DOMAINS[p][fullStates[parents.indexOf(p)]];
        const shift = policyLogShift(id, policy, context.groundedStrength);
        if (shift) dist = dist.map((v, k) => v * Math.exp(shift[k] ?? 0));
      }

      const sum = dist.reduce((a, b) => a + b, 0) || 1;
      table[keyFor(fullStates)] = dist.map((v) => v / sum);
    }

    const provenance = hasObservableData
      ? latentParents.length + policyParents.length + shockParents.length > 0
        ? "estimated_from_population+prior:assumption"
        : "estimated_from_population"
      : prior.source;

    cpts[id] = {
      node: id,
      table,
      marginal,
      source: provenance,
      provenance,
    };
  }

  const bn: Bn = {
    version: BN_VERSION,
    nodes,
    order: [...MICRO_NODES, ...TOWN_NODES, ...FEEDBACK_NODES],
    cpts,
  };

  // The engine validates the dynamic graph BEFORE it runs it: a malformed
  // network fails loudly here rather than silently producing a simulation.
  assertValidBnGraph(bn);
  return bn;
}

/* ------------------------------------------------------------------ */
/* Dynamic-graph validation                                            */
/* ------------------------------------------------------------------ */

/** Return one node id left inside a cycle, or null when the graph is acyclic. */
function findCycleNode(bn: Bn): string | null {
  const ids = Object.keys(bn.nodes);
  const indegree: Record<string, number> = {};
  const adjacency: Record<string, string[]> = {};
  for (const id of ids) {
    indegree[id] = 0;
    adjacency[id] = [];
  }
  for (const id of ids) {
    for (const parent of bn.nodes[id].parents) {
      if (!bn.nodes[parent]) continue;
      adjacency[parent].push(id);
      indegree[id] += 1;
    }
  }
  const queue = ids.filter((id) => indegree[id] === 0);
  let visited = 0;
  while (queue.length > 0) {
    const node = queue.shift() as string;
    visited += 1;
    for (const child of adjacency[node]) {
      indegree[child] -= 1;
      if (indegree[child] === 0) queue.push(child);
    }
  }
  if (visited === ids.length) return null;
  return ids.filter((id) => indegree[id] > 0).join(", ");
}

/**
 * Validate a dynamic Bayesian network. Detects duplicate node ids, missing
 * parents, invalid domains, circular dependencies, invalid CPT dimensions,
 * probabilities outside [0,1], rows that do not normalise, and nodes assigned
 * to an invalid evaluation pass. Pure: it inspects the graph and reports.
 */
export function validateBnGraph(bn: Bn): ValidationCheck[] {
  const checks: ValidationCheck[] = [];
  const add = (check: string, passed: boolean, observed: string, expected: string) =>
    checks.push({ group: "network", check, passed, observed, expected });

  const ids = Object.keys(bn.nodes);

  // Node ids are object keys, so uniqueness there is structural; the real risk
  // is a duplicate in the SCHEDULING order or the declarative registry, both of
  // which are arrays.
  const duplicates: string[] = [];
  const seenOrder = new Set<string>();
  for (const id of bn.order) {
    if (seenOrder.has(id)) duplicates.push(id);
    seenOrder.add(id);
  }
  const specIds = NODE_REGISTRY.map((spec) => spec.id);
  const registryDup = specIds.filter((id, i) => specIds.indexOf(id) !== i);
  add(
    "no duplicate node ids",
    duplicates.length === 0 && registryDup.length === 0,
    [...duplicates, ...registryDup].join(", ") || `${ids.length} unique ids`,
    "unique ids in the registry and the scheduling order",
  );

  const registryIds = new Set(NODE_REGISTRY.map((spec) => spec.id));
  const unregistered = ids.filter((id) => !registryIds.has(id));
  add(
    "every node is declared in the registry",
    unregistered.length === 0,
    unregistered.join(", ") || "all nodes declared",
    "no undeclared nodes",
  );

  const dangling: string[] = [];
  for (const id of ids) for (const parent of bn.nodes[id].parents) if (!bn.nodes[parent]) dangling.push(`${id} -> ${parent}`);
  add("every parent node exists", dangling.length === 0, dangling.join(", ") || "all parents resolved", "no missing parents");

  const badDomain = ids.filter((id) => {
    const domain = bn.nodes[id].domain;
    return domain.length === 0 || new Set(domain).size !== domain.length;
  });
  add(
    "every node has a non-empty, duplicate-free domain",
    badDomain.length === 0,
    badDomain.join(", ") || "all domains valid",
    "valid state domains",
  );

  const cycle = findCycleNode(bn);
  add("graph is acyclic", cycle === null, cycle ?? "topological order exists", "no directed cycle");

  let dimError = "";
  let probError = "";
  let normError = "";
  for (const id of ids) {
    const node = bn.nodes[id];
    const cpt = bn.cpts[id];
    if (!cpt) {
      dimError = dimError || `${id}: no conditional table`;
      continue;
    }
    const expectedRows = node.parents.reduce((acc, parent) => acc * (bn.nodes[parent]?.domain.length ?? 1), 1);
    const rows = Object.keys(cpt.table);
    if (rows.length !== expectedRows) dimError = dimError || `${id}: ${rows.length}/${expectedRows} rows`;
    for (const key of rows) {
      const dist = cpt.table[key];
      if (dist.length !== node.domain.length) {
        dimError = dimError || `${id}[${key}]: ${dist.length} != ${node.domain.length}`;
        break;
      }
      const sum = dist.reduce((a, b) => a + b, 0);
      if (Math.abs(sum - 1) > 1e-9) {
        normError = normError || `${id}[${key}] sums to ${sum.toFixed(6)}`;
        break;
      }
      if (dist.some((v) => !(v >= 0 && v <= 1))) {
        probError = probError || `${id}[${key}] has a value outside [0,1]`;
        break;
      }
    }
  }
  add("CPT rows match the declared parent dimensions", dimError === "", dimError || "all tables fully populated", "one row per parent-state combination");
  add("every probability is inside [0,1]", probError === "", probError || "all probabilities valid", "no p < 0 or p > 1");
  add("every CPT row normalises to 1", normError === "", normError || "all rows sum to 1", "each row sums to 1");

  const badPass = ids.filter((id) => !["micro", "town", "feedback"].includes(NODE_PASS[id] ?? ""));
  add(
    "every node declares a valid evaluation pass",
    badPass.length === 0,
    badPass.join(", ") || `${ids.length} nodes scheduled`,
    "micro / town / feedback",
  );

  return checks;
}

/** Throw when the network is not a valid dynamic graph. */
export function assertValidBnGraph(bn: Bn): void {
  const failed = validateBnGraph(bn).filter((check) => !check.passed);
  if (failed.length > 0) {
    throw new Error(
      `Invalid Bayesian network: ${failed.map((f) => `${f.check} (${f.observed})`).join("; ")}`,
    );
  }
}

/* ------------------------------------------------------------------ */
/* Compiled form (fast inference)                                      */
/* ------------------------------------------------------------------ */

export interface CompiledBn {
  bn: Bn;
  ids: string[];
  index: Record<string, number>;
  domainSize: number[];
  parentIdx: number[][];
  strides: number[][];
  tables: Float64Array[];
  cumulative: Float64Array[];
  marginal: Float64Array[];
}

export function compileBn(bn: Bn): CompiledBn {
  const ids = Object.keys(bn.nodes);
  const index: Record<string, number> = {};
  ids.forEach((id, i) => {
    index[id] = i;
  });
  const domainSize = ids.map((id) => bn.nodes[id].domain.length);
  const parentIdx = ids.map((id) => bn.nodes[id].parents.map((p) => index[p]));
  const strides = parentIdx.map((ps) => {
    const st: number[] = new Array(ps.length).fill(1);
    for (let k = ps.length - 2; k >= 0; k -= 1) {
      st[k] = st[k + 1] * domainSize[ps[k + 1]];
    }
    return st;
  });

  const tables = ids.map((id, i) => {
    const combos = parentIdx[i].reduce((acc, p) => acc * domainSize[p], 1);
    const n = domainSize[i];
    const flat = new Float64Array(combos * n);
    const cpt = bn.cpts[id];
    for (let c = 0; c < combos; c += 1) {
      const states = comboStates(
        c,
        parentIdx[i].map((p) => domainSize[p]),
      );
      const dist = cpt?.table[keyFor(states)] ?? cpt?.marginal ?? uniform(n);
      for (let s = 0; s < n; s += 1) flat[c * n + s] = dist[s] ?? 0;
    }
    return flat;
  });

  const cumulative = tables.map((t, i) => {
    const n = domainSize[i];
    const combos = t.length / n;
    const out = new Float64Array(t.length);
    for (let c = 0; c < combos; c += 1) {
      toCumulative(t.subarray(c * n, (c + 1) * n), out.subarray(c * n, (c + 1) * n));
    }
    return out;
  });

  const marginal = ids.map((id) => Float64Array.from(bn.cpts[id]?.marginal ?? uniform(domainSize[index[id]])));

  return { bn, ids, index, domainSize, parentIdx, strides, tables, cumulative, marginal };
}

function drawNode(c: CompiledBn, nodeIdx: number, states: Int32Array, r: number): number {
  const ps = c.parentIdx[nodeIdx];
  const n = c.domainSize[nodeIdx];
  let combo = 0;
  for (let k = 0; k < ps.length; k += 1) combo += states[ps[k]] * c.strides[nodeIdx][k];
  const base = combo * n;
  const cum = c.cumulative[nodeIdx];
  for (let s = 0; s < n; s += 1) {
    if (r < cum[base + s]) return s;
  }
  return n - 1;
}

export interface Evidence {
  [nodeId: string]: string | number | undefined;
}

export function applyEvidence(c: CompiledBn, states: Int32Array, evidence: Evidence): Uint8Array {
  const fixed = new Uint8Array(c.ids.length);
  for (const nodeId of Object.keys(evidence)) {
    const v = evidence[nodeId];
    if (v === undefined || v === null) continue;
    const idx = c.index[nodeId];
    if (idx === undefined) continue;
    const state = typeof v === "number" ? v : c.bn.nodes[nodeId].domain.indexOf(v);
    if (state < 0) continue;
    states[idx] = state;
    fixed[idx] = 1;
  }
  return fixed;
}

/**
 * Precondition for exact ancestral sampling.
 *
 * Sampling is exact when every piece of evidence sits on a node whose own
 * ancestry is fully fixed, i.e. conditioning is applied to a variable that is a
 * deterministic function of the fixed upstream state. In this system that means
 * all roots are evidence (which the simulation guarantees) and any non-root
 * evidence — such as the computed Inflation band — has fixed parents.
 *
 * Throws rather than silently producing biased samples.
 */
export function assertEvidenceIsUpstream(c: CompiledBn, fixed: Uint8Array): void {
  for (let i = 0; i < c.ids.length; i += 1) {
    if (!fixed[i]) continue;
    for (const p of c.parentIdx[i]) {
      if (fixed[p]) continue;
      throw new Error(
        `BN evidence precondition violated: "${c.ids[i]}" is conditioned on but its parent "${c.ids[p]}" is neither fixed nor sampled upstream.`,
      );
    }
  }
}

export function sampleNodes(
  c: CompiledBn,
  states: Int32Array,
  fixed: Uint8Array,
  nodeIds: readonly string[],
  rng: Rng,
): void {
  for (const id of nodeIds) {
    const idx = c.index[id];
    if (idx === undefined || fixed[idx]) continue;
    states[idx] = drawNode(c, idx, states, rng.next());
  }
}

/**
 * Draw any root that was not supplied as evidence from its own distribution.
 *
 * This matters for `do(...)`: cutting an intervened node's parents turns it
 * into a root, and its point-mass table must then be honoured. Without this
 * step an unspecified root would silently remain at state 0.
 */
export function sampleRoots(c: CompiledBn, states: Int32Array, fixed: Uint8Array, rng: Rng): void {
  for (const id of ROOT_NODE_IDS) {
    const idx = c.index[id];
    if (idx === undefined || fixed[idx]) continue;
    // Exogenous shock roots default to "none" WITHOUT drawing: they are always
    // supplied as evidence by the engine, and skipping the draw keeps a run that
    // configures no scenario byte-identical to the pre-shock network (no uniform
    // is consumed, so no established node's sample shifts).
    if (EXTERNAL_SHOCK_NODE_IDS.includes(id)) continue;
    states[idx] = drawNode(c, idx, states, rng.next());
  }
}

/**
 * Generic pass scheduler. Walks NODE_REGISTRY and draws every node in the
 * requested pass, in registry order. The micro pass samples roots first, since
 * a root has no parents and is the evidence for everything downstream.
 *
 * This replaces the three hardcoded named functions: a node added to the
 * registry with `pass: "micro"` is scheduled automatically, provided its
 * parents appear earlier in the registry.
 */
export function samplePass(
  c: CompiledBn,
  states: Int32Array,
  fixed: Uint8Array,
  pass: "micro" | "town" | "feedback",
  rng: Rng,
  extensionRng?: Rng,
): void {
  if (pass === "micro") sampleRoots(c, states, fixed, rng);
  for (const id of PASS_SCHEDULE[pass]) {
    const spec = c.bn.nodes[id];
    if (!spec || spec.parents.length === 0) continue; // roots handled above
    const idx = c.index[id];
    if (idx === undefined || fixed[idx]) continue;
    // Extension nodes draw from the isolated stream when one is supplied, so
    // the established nodes' uniforms are never shifted by adding a node.
    const isExtension = EXTENSION_NODES.has(id);
    if (isExtension && !extensionRng) continue;
    const draw = isExtension ? extensionRng!.next() : rng.next();
    states[idx] = drawNode(c, idx, states, draw);
  }
}

/**
 * Sample the micro pass. `extensionRng`, when supplied, feeds the nodes added
 * after the original network so they do not perturb the established stream.
 */
export function sampleMicro(
  c: CompiledBn,
  states: Int32Array,
  fixed: Uint8Array,
  rng: Rng,
  extensionRng?: Rng,
): void {
  samplePass(c, states, fixed, "micro", rng, extensionRng);
}

/** A deterministic secondary stream for the extension nodes, from a run's seed. */
export function extensionRngFor(seed: number): Rng {
  return createRng((seed ^ 0x9e3779b1) >>> 0);
}

export function sampleTownAndFeedback(c: CompiledBn, states: Int32Array, fixed: Uint8Array, rng: Rng): void {
  samplePass(c, states, fixed, "town", rng);
  samplePass(c, states, fixed, "feedback", rng);
}

/** Marginal distribution of a node given evidence, by ancestral sampling. */
export function posteriorDistribution(
  c: CompiledBn,
  nodeId: string,
  evidence: Evidence,
  n: number,
  rng: Rng,
  scratch?: Int32Array,
): number[] {
  const idx = c.index[nodeId];
  const counts = new Array(c.domainSize[idx]).fill(0);
  const states = scratch ?? new Int32Array(c.ids.length);
  const extRng = extensionRngFor(rng.seed);
  for (let k = 0; k < n; k += 1) {
    states.fill(0);
    const fixed = applyEvidence(c, states, evidence);
    sampleMicro(c, states, fixed, rng, extRng);
    sampleTownAndFeedback(c, states, fixed, rng);
    counts[states[idx]] += 1;
  }
  return counts.map((v) => v / n);
}

/**
 * Causal attribution by mutual information: how much does knowing an ancestor
 * change what we believe about the target? This is the explainability the
 * abandoned Random Forest could not offer (paper §5).
 */
export function causalAttribution(
  c: CompiledBn,
  target: string,
  evidence: Evidence,
  n: number,
  rng: Rng,
): CausalFactor[] {
  const tIdx = c.index[target];
  const targetN = c.domainSize[tIdx];
  const candidates = Object.keys(DOMAINS).filter(
    (id) => id !== target && !AGGREGATE_NODES.includes(id) && !EXTERNAL_SHOCK_NODE_IDS.includes(id),
  );
  const joint = candidates.map(() => new Float64Array(2 * targetN));
  const tCounts = new Float64Array(targetN);
  const states = new Int32Array(c.ids.length);
  const extRng = extensionRngFor(rng.seed);

  for (let k = 0; k < n; k += 1) {
    states.fill(0);
    const fixed = applyEvidence(c, states, evidence);
    sampleMicro(c, states, fixed, rng, extRng);
    sampleTownAndFeedback(c, states, fixed, rng);
    const t = states[tIdx];
    tCounts[t] += 1;
    for (let ai = 0; ai < candidates.length; ai += 1) {
      const aIdx = c.index[candidates[ai]];
      const half = Math.floor(c.domainSize[aIdx] / 2);
      const bucket = states[aIdx] < half ? 0 : 1;
      joint[ai][bucket * targetN + t] += 1;
    }
  }

  const factors: CausalFactor[] = [];
  for (let ai = 0; ai < candidates.length; ai += 1) {
    let mi = 0;
    for (let b = 0; b < 2; b += 1) {
      let pA = 0;
      for (let t = 0; t < targetN; t += 1) pA += joint[ai][b * targetN + t] / n;
      if (pA <= 0) continue;
      for (let t = 0; t < targetN; t += 1) {
        const pJoint = joint[ai][b * targetN + t] / n;
        if (pJoint <= 0) continue;
        const pT = tCounts[t] / n;
        if (pT <= 0) continue;
        mi += pJoint * Math.log(pJoint / (pA * pT));
      }
    }
    factors.push({ node: candidates[ai], influence: mi });
  }

  factors.sort((a, b) => b.influence - a.influence);
  const max = factors[0]?.influence || 1;
  return factors.slice(0, 8).map((f) => ({ node: f.node, influence: f.influence / max }));
}

/* ------------------------------------------------------------------ */
/* Interventions (do-calculus)                                         */
/* ------------------------------------------------------------------ */

/**
 * `do(X = x)`: cut X's incoming edges and set it to a point mass. Observing
 * that a policy was applied and imposing one are different questions; a
 * decision-support tool must answer the second.
 */
export function withIntervention(bn: Bn, interventions: Record<string, string>): Bn {
  const nodes: Record<string, BnNode> = {};
  for (const id of Object.keys(bn.nodes)) {
    nodes[id] = { ...bn.nodes[id], parents: interventions[id] ? [] : bn.nodes[id].parents };
  }

  const cpts: Record<string, Cpt> = {};
  for (const id of Object.keys(bn.cpts)) {
    const original = bn.cpts[id];
    if (interventions[id]) {
      const domain = bn.nodes[id].domain;
      const state = domain.indexOf(interventions[id]);
      const dist = domain.map((_, i) => (i === state ? 1 : 0));
      cpts[id] = { node: id, table: { "": dist }, marginal: dist, source: "intervention:do", provenance: "intervention:do" };
      continue;
    }
    const oldParents = bn.nodes[id].parents;
    const newParents = nodes[id].parents;
    if (newParents.length === oldParents.length) {
      cpts[id] = original;
      continue;
    }
    const table: Record<string, number[]> = {};
    const sizes = newParents.map((p) => bn.nodes[p].domain.length);
    const combos = sizes.reduce((a, b) => a * b, 1);
    for (let c = 0; c < combos; c += 1) {
      const states = comboStates(c, sizes);
      const full = oldParents.map((p) =>
        newParents.includes(p) ? states[newParents.indexOf(p)] : bn.nodes[p].domain.indexOf(interventions[p]),
      );
      table[keyFor(full)] = original.table[keyFor(full)] ?? original.marginal.slice();
    }
    cpts[id] = { ...original, table, source: `${original.source}+intervention:do`, provenance: "intervention:do" };
  }

  return { ...bn, nodes, cpts };
}

/* ------------------------------------------------------------------ */
/* Validation (§6.6)                                                   */
/* ------------------------------------------------------------------ */

function randomAgentEvidence(pop: Population, agent: number, extra?: Evidence): Evidence {
  return {
    IncomeClassPrior: INCOME_CLASSES[pop.incomeClass[agent]],
    AgeBand: AGE_BANDS[pop.ageBand[agent]],
    EducationLevel: EDUCATION_LEVELS[pop.education[agent]],
    HousingQuality: QUALITY_LEVELS[pop.housing[agent]],
    TrustInGov: TRUST_BANDS[pop.trustInGov[agent] < 0.36 ? 0 : pop.trustInGov[agent] < 0.6 ? 1 : 2],
    // Hold the town backdrop at its neutral setting. Inflation is deliberately
    // left SAMPLED so the demand -> inflation channel can still respond; that
    // is what the "high budget share raises inflation" check exercises.
    AggregateDemand: "normal",
    AggregateSectorOutput: "stable",
    EmploymentAggregate: "normal",
    MigrationAggregate: "low",
    ...(extra ?? {}),
  };
}

/** Probability that `target` lands in `targetStates` under a given policy. */
export function policyResponse(
  c: CompiledBn,
  pop: Population,
  policy: Record<string, string>,
  target: string,
  targetStates: number[],
  n: number,
  rng: Rng,
  extraEvidence?: Evidence,
): number {
  const idx = c.index[target];
  const states = new Int32Array(c.ids.length);
  const extRng = extensionRngFor(rng.seed);
  let hits = 0;
  for (let k = 0; k < n; k += 1) {
    states.fill(0);
    const evidence: Evidence = {
      PolicyType: policy.PolicyType ?? "none",
      PolicyIntensity: policy.PolicyIntensity ?? "medium",
      PolicyBudgetShare: policy.PolicyBudgetShare ?? "medium",
      PolicyDuration: policy.PolicyDuration ?? "medium",
      ...randomAgentEvidence(pop, rng.int(pop.size), extraEvidence),
    };
    const fixed = applyEvidence(c, states, evidence);
    sampleMicro(c, states, fixed, rng, extRng);
    sampleTownAndFeedback(c, states, fixed, rng);
    if (targetStates.includes(states[idx])) hits += 1;
  }
  return hits / n;
}

export function validateBnDirection(bn: Bn, pop: Population, n = 1000): ValidationCheck[] {
  const c = compileBn(bn);
  const rng = createRng(0x51af1e);
  const checks: ValidationCheck[] = [];
  const add = (check: string, passed: boolean, observed: string, expected: string) => {
    checks.push({ group: "network", check, passed, observed, expected });
  };

  const cases: { check: string; policy: Record<string, string>; target: string; states: number[]; extra?: Evidence }[] = [
    {
      check: "subsidy raises P(formal employment)",
      policy: { PolicyType: "subsidy", PolicyIntensity: "high", PolicyBudgetShare: "high" },
      target: "EmploymentStatus",
      states: [2],
    },
    {
      check: "high budget share raises P(high inflation)",
      policy: { PolicyType: "subsidy", PolicyIntensity: "high", PolicyBudgetShare: "high" },
      target: "Inflation",
      states: [2],
    },
    {
      check: "housing policy improves positive sentiment",
      policy: { PolicyType: "housing", PolicyIntensity: "high", PolicyBudgetShare: "high" },
      target: "PublicSentiment",
      states: [2],
    },
    {
      // Migration is rare in this town, so the meaningful comparison is
      // "consider leaving or leaving" rather than the leaving band alone.
      check: "unemployed + obsolete skills raises P(consider or leave)",
      policy: { PolicyType: "none" },
      target: "MigrationIntentBand",
      states: [1, 2],
      extra: { EmploymentStatus: "unemployed", SkillRelevance: "obsolete" },
    },
    {
      check: "long education policy raises high-growth probability",
      policy: { PolicyType: "education", PolicyIntensity: "high", PolicyBudgetShare: "high", PolicyDuration: "long" },
      target: "TownGDPGrowthBand",
      states: [3, 4],
    },
  ];

  for (const tc of cases) {
    const base = policyResponse(c, pop, { PolicyType: "none" }, tc.target, tc.states, n, rng, tc.extra);
    const treated = policyResponse(c, pop, tc.policy, tc.target, tc.states, n, rng, tc.extra);
    add(
      tc.check,
      treated > base,
      `${(treated * 100).toFixed(1)}% vs ${(base * 100).toFixed(1)}% baseline`,
      "strictly greater than the no-policy baseline",
    );
  }

  const withoutSource = Object.keys(bn.cpts).filter((id) => !bn.cpts[id].source || !bn.cpts[id].provenance);
  add(
    "every CPT carries provenance",
    withoutSource.length === 0,
    withoutSource.length === 0 ? "all tables annotated" : withoutSource.join(", "),
    "no unannotated tables",
  );

  let badTable = "";
  for (const id of Object.keys(bn.cpts)) {
    for (const k of Object.keys(bn.cpts[id].table)) {
      const sum = bn.cpts[id].table[k].reduce((a, b) => a + b, 0);
      if (Math.abs(sum - 1) > 1e-9) {
        badTable = `${id}[${k}] = ${sum.toFixed(6)}`;
        break;
      }
    }
    if (badTable) break;
  }
  add("all CPT rows normalised", badTable === "", badTable || "every row sums to 1", "every row sums to 1");

  const estimated = Object.keys(bn.cpts).filter((id) => bn.cpts[id].provenance.includes("estimated_from_population"));
  add(
    "CPTs learned from data, not hand-authored",
    estimated.length >= 10,
    `${estimated.length} of ${Object.keys(bn.cpts).length} tables estimated from the population`,
    "majority of tables estimated from the population",
  );

  return checks;
}

/** Directed intervention response, used by the UI's sensitivity readout. */
export function interventionEffect(
  c: CompiledBn,
  pop: Population,
  base: Record<string, string>,
  treated: Record<string, string>,
  target: string,
  targetStates: number[],
  n: number,
  rng: Rng,
): { baseline: number; treated: number } {
  return {
    baseline: policyResponse(c, pop, base, target, targetStates, n, rng),
    treated: policyResponse(c, pop, treated, target, targetStates, n, rng),
  };
}

export const AGE_BAND_DOMAIN = AGE_BANDS;
export const EDUCATION_DOMAIN = EDUCATION_LEVELS;
