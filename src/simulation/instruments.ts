/**
 * Instrument parameter dictionary (SPEC §5.1).
 *
 * Every policy instrument used to be forced through the same Housing /
 * Education / Employment allocation sliders, whether or not that split meant
 * anything for the instrument. This file replaces that with a dictionary keyed
 * by instrument that declares, per instrument:
 *
 *   - `parameters`        — the engine parameters the Lab actually renders
 *                           (allocation is included ONLY where it genuinely
 *                           applies; tax / regulation / healthcare do not use a
 *                           three-way split),
 *   - `channels`          — the Bayesian-network nodes the instrument's
 *                           documented shifts are allowed to affect,
 *   - `newNodesRequired`  — nodes this instrument needs that the registry does
 *                           NOT yet define. These are listed explicitly rather
 *                           than silently reusing the housing/education/
 *                           employment channel,
 *   - `declaredParameters`— instrument-specific knobs that are declared but not
 *                           yet read by the engine. They are rendered as
 *                           explicitly-unwired, never as working controls.
 *
 * Nothing here computes an outcome. It is a description of the controls and the
 * channels, consumed by the Lab's UI and by the engine's decoder.
 */

import type { MetricKey, PolicyType } from "./types";

/** An engine parameter the Lab renders for a given instrument. */
export type InstrumentParamId = "intensity" | "budget" | "duration" | "allocation";

export interface InstrumentParam {
  id: InstrumentParamId;
  label: string;
  help: string;
}

/** A knob that is declared for the instrument but not yet wired into the engine. */
export interface DeclaredParameter {
  key: string;
  label: string;
  /** What it would drive once wired. */
  drives: string[];
  /** Why it is not wired yet. */
  note: string;
}

export interface InstrumentDefinition {
  id: PolicyType;
  label: string;
  summary: string;
  /** Engine parameters the Lab renders for this instrument, in order. */
  parameters: InstrumentParam[];
  /** BN nodes this instrument's documented shifts are allowed to affect. */
  channels: string[];
  /** Nodes this instrument needs that the node registry does not yet define. */
  newNodesRequired: string[];
  /** Instrument-specific knobs, declared but not yet read by the engine. */
  declaredParameters: DeclaredParameter[];
  /** Allocation used when the three-way split does not apply to the instrument. */
  defaultAllocation?: { housing: number; education: number; employment: number };
  /** Metrics this instrument's channels are meant to move. */
  directTargets: MetricKey[];
}

const INTENSITY: InstrumentParam = {
  id: "intensity",
  label: "Intensity",
  help: "Share of the instrument's maximum documented strength.",
};
const BUDGET: InstrumentParam = { id: "budget", label: "Budget", help: "Total programme cost." };
const DURATION: InstrumentParam = { id: "duration", label: "Duration", help: "Months the programme runs." };
const ALLOCATION: InstrumentParam = {
  id: "allocation",
  label: "Allocation",
  help: "Housing / education / employment split. Normalised to sum to 1 before the run.",
};

const NO_ALLOCATION = { housing: 0, education: 0, employment: 0 } as const;

export const INSTRUMENTS: Record<PolicyType, InstrumentDefinition> = {
  none: {
    id: "none",
    label: "No policy",
    summary: "The counterfactual: the same engine with every instrument switched off.",
    parameters: [],
    channels: [],
    newNodesRequired: [],
    declaredParameters: [],
    defaultAllocation: NO_ALLOCATION,
    directTargets: [],
  },

  subsidy: {
    id: "subsidy",
    label: "Subsidy / transfer",
    summary:
      "Direct transfers and subsidies. The one instrument where the housing / education / employment split genuinely applies: each slice scales a distinct mechanism in the period loop.",
    parameters: [INTENSITY, BUDGET, DURATION, ALLOCATION],
    channels: [
      "SectorDemand",
      "IncomeClass",
      "EmploymentStatus",
      "SpendingCapacity",
      "Inflation",
      "PublicSentiment",
      "ProtestRiskBand",
    ],
    newNodesRequired: [],
    declaredParameters: [
      {
        key: "targeting",
        label: "Targeting rule",
        drives: ["IncomeClass", "EmploymentStatus"],
        note: "Declared for the roadmap. Today the instrument reaches everyone up to informality, not a chosen group.",
      },
    ],
    defaultAllocation: { housing: 0.3, education: 0.3, employment: 0.4 },
    directTargets: ["employmentRatePct", "meanIncome", "wageIndex", "happinessIndex"],
  },

  tax: {
    id: "tax",
    label: "Tax change",
    summary:
      "Revenue collection and its demand-side effect. Has no housing / education / employment split, so the Lab does not show one.",
    parameters: [INTENSITY, BUDGET, DURATION],
    channels: [
      "SectorDemand",
      "IncomeClass",
      "EmploymentStatus",
      "SpendingCapacity",
      "Inflation",
      "PublicSentiment",
      "ProtestRiskBand",
    ],
    newNodesRequired: [],
    declaredParameters: [
      {
        key: "progressivity",
        label: "Progressivity",
        drives: ["IncomeClass", "SpendingCapacity"],
        note: "Declared for the roadmap. Today the tax channel applies with a single intensity and no rate structure.",
      },
    ],
    defaultAllocation: NO_ALLOCATION,
    directTargets: ["inflationPct", "gini"],
  },

  labor: {
    id: "labor",
    label: "Labour market programme",
    summary:
      "Training, placement and wage support. Keeps the split because the employment slice scales the earnings lift and the education slice scales the human-capital lift.",
    parameters: [INTENSITY, BUDGET, DURATION, ALLOCATION],
    channels: ["SectorDemand", "EmploymentStatus", "Inflation", "PublicSentiment"],
    newNodesRequired: [],
    declaredParameters: [
      {
        key: "trainingVsPlacement",
        label: "Training vs. placement mix",
        drives: ["SkillRelevance", "EmploymentStatus"],
        note: "Declared for the roadmap. Today the employment / education slices stand in for it.",
      },
    ],
    defaultAllocation: { housing: 0.1, education: 0.4, employment: 0.5 },
    directTargets: ["employmentRatePct", "meanIncome", "wageIndex"],
  },

  housing: {
    id: "housing",
    label: "Housing programme",
    summary:
      "Dwelling construction and upgrading. The housing slice is central: it gates the durable housing upgrade and the trust update.",
    parameters: [INTENSITY, BUDGET, DURATION, ALLOCATION],
    channels: [
      "SectorDemand",
      "IncomeClass",
      "EmploymentStatus",
      "SpendingCapacity",
      "Inflation",
      "PublicSentiment",
      "ProtestRiskBand",
    ],
    newNodesRequired: [],
    declaredParameters: [
      {
        key: "tenureMix",
        label: "Ownership vs. rental mix",
        drives: ["HousingQuality", "HouseholdStress"],
        note: "Declared for the roadmap. Today housing quality is a single modelled stock, not a tenure mix.",
      },
    ],
    defaultAllocation: { housing: 0.7, education: 0.1, employment: 0.2 },
    directTargets: ["happinessIndex", "gini", "meanIncome"],
  },

  education: {
    id: "education",
    label: "Education / skills",
    summary:
      "Human capital and retraining. The education slice scales the skills and savings channels; effects carry the documented long lag.",
    parameters: [INTENSITY, BUDGET, DURATION, ALLOCATION],
    channels: ["SectorDemand", "IncomeClass", "EmploymentStatus", "PublicSentiment"],
    newNodesRequired: [],
    declaredParameters: [
      {
        key: "levelMix",
        label: "Schooling vs. vocational mix",
        drives: ["EducationLevel", "SkillRelevance"],
        note: "Declared for the roadmap. Today the instrument moves skill relevance, not attainment levels.",
      },
    ],
    defaultAllocation: { housing: 0.1, education: 0.7, employment: 0.2 },
    directTargets: ["gdpGrowthPct", "employmentRatePct", "wageIndex"],
  },

  regulation: {
    id: "regulation",
    label: "Regulation",
    summary:
      "Compliance and enforcement. Has no spending split; its documented channels are demand suppression and protest risk.",
    parameters: [INTENSITY, BUDGET, DURATION],
    channels: ["SectorDemand", "EmploymentStatus", "PublicSentiment", "ProtestRiskBand"],
    newNodesRequired: [],
    declaredParameters: [
      {
        key: "enforcementStrength",
        label: "Enforcement strength",
        drives: ["SectorDemand", "ProtestRiskBand"],
        note: "Declared for the roadmap. Today enforcement and rule strictness share one intensity.",
      },
    ],
    defaultAllocation: NO_ALLOCATION,
    directTargets: ["protestRisk", "inflationPct"],
  },

  health: {
    id: "health",
    label: "Healthcare / insurance",
    summary:
      "Coverage expansion and health-cost relief. A GENUINELY NEW category: a run was previously attempted under a healthcare label with no dedicated channel, so it just scaled the generic subsidy response. It now declares the nodes it needs.",
    // Healthcare is not a three-way housing/education/employment split.
    parameters: [INTENSITY, BUDGET, DURATION],
    channels: [
      "HealthInsurance",
      "HealthBurden",
      "HouseholdStress",
      "IncomeClass",
      "EmploymentStatus",
      "SpendingCapacity",
      "PublicSentiment",
      "ProtestRiskBand",
    ],
    // These are declared in the node registry, but their conditional structure is
    // a MODELLED ASSUMPTION (see bn.ts NODE_REGISTRY) because no evaluated
    // insurance programme is calibrated here. Listed so the UI can say exactly
    // what a healthcare run depends on.
    newNodesRequired: ["HealthInsurance", "HealthBurden"],
    declaredParameters: [
      {
        key: "coverageTarget",
        label: "Coverage target",
        drives: ["HealthInsurance", "HealthBurden"],
        note: "Declared for the roadmap. Today coverage moves through intensity and budget, not an explicit enrolment target.",
      },
      {
        key: "premiumSubsidy",
        label: "Premium subsidy share",
        drives: ["HealthBurden", "SpendingCapacity"],
        note: "Declared for the roadmap. Today out-of-pocket burden is modelled from coverage, not from a premium structure.",
      },
    ],
    defaultAllocation: NO_ALLOCATION,
    directTargets: ["happinessIndex", "meanIncome", "gini"],
  },
};

/** Instruments shown in the Lab's instrument picker (everything but `none`). */
export const LIVE_INSTRUMENTS: InstrumentDefinition[] = Object.values(INSTRUMENTS).filter(
  (i) => i.id !== "none",
);

export function instrumentFor(type: PolicyType): InstrumentDefinition {
  return INSTRUMENTS[type] ?? INSTRUMENTS.none;
}

/** Whether the three-way allocation split applies to an instrument. */
export function instrumentUsesAllocation(type: PolicyType): boolean {
  return instrumentFor(type).parameters.some((p) => p.id === "allocation");
}

/** The allocation to use for an instrument: its own, or the declared default. */
export function allocationFor(
  type: PolicyType,
  params: { housing: number; education: number; employment: number },
): { housing: number; education: number; employment: number } {
  if (instrumentUsesAllocation(type)) return params;
  return instrumentFor(type).defaultAllocation ?? NO_ALLOCATION;
}
