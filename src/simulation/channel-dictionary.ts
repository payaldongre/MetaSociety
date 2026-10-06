/**
 * Channel dictionary — replaces the closed PolicyType enum.
 *
 * THE PROBLEM THIS FIXES: POLICY_TYPES in types.ts used to be a hardcoded list
 * of 8 strings. Any policy that wasn't literally one of those words had nowhere
 * to go. "Healthcare" only worked because a developer manually added it as a 9th
 * slot — the next unseen policy needed the same manual work all over again. That
 * does not scale and contradicts the whole point: policies are not determinate
 * in advance.
 *
 * THE FIX: a policy is not ONE instrument. It is a NAME plus a SET of one or
 * more CHANNELS it plausibly touches. A single policy can tag multiple channels
 * (a "digital health ID" policy might tag both DIGITAL_ACCESS and
 * HEALTHCARE_ACCESS at once — something a single-instrument dropdown could never
 * represent). New channels are added here, in one place, without touching the
 * UI's instrument list, because there no longer IS a fixed instrument list.
 *
 * WHAT THIS FILE DOES NOT SOLVE: adding a channel here with `status: "declared"`
 * is a DECLARATION, not an implementation. Someone still has to design that
 * channel's real conditional-probability relationships in the node registry.
 * This file makes that gap visible and explicit (status: "declared") instead of
 * silently mis-routing the policy through an unrelated channel, which is what
 * happened to the original healthcare test run.
 */

import type { MetricKey } from "./types";

export type ChannelStatus =
  /** Every BN node this channel needs already exists and is wired. */
  | "implemented"
  /** Declared and named, but at least one required BN node does not exist
   *  yet. The engine must refuse to silently substitute a generic channel —
   *  see `UnroutedChannelWarning` below. */
  | "declared";

export interface ChannelParam {
  key: string;
  label: string;
  type: "percent" | "currency" | "months" | "share";
  min: number;
  max: number;
  default: number;
  help: string;
}

export interface ChannelDefinition {
  id: string;
  label: string;
  summary: string;

  /** Free-text keywords used to AUTO-SUGGEST this channel from a policy
   *  name, via `suggestChannels()` below. This is a suggestion the user
   *  confirms, never a silent auto-assignment. */
  keywords: string[];

  /** Parameters this channel contributes when selected. A policy's full
   *  parameter set is the UNION of its selected channels' parameters,
   *  de-duplicated by key. */
  parameters: ChannelParam[];

  /** BN nodes this channel's effects are allowed to move. */
  bnNodes: string[];

  status: ChannelStatus;

  /** Only meaningful when status === "declared": which of bnNodes do not
   *  exist in the registry yet, and therefore need real design work before
   *  this channel can run for real (not just render its sliders). */
  bnNodesPending?: string[];

  /** Metrics this channel's documented effect should move. */
  directTargets: MetricKey[];
}

// ---------------------------------------------------------------- Channels

export const CHANNELS: Record<string, ChannelDefinition> = {
  INCOME_SUPPORT: {
    id: "INCOME_SUPPORT",
    label: "Income support / cash transfer",
    summary: "Direct cash, subsidies, or transfers that change disposable income.",
    keywords: ["subsidy", "transfer", "cash", "stipend", "allowance", "ubi", "grant"],
    parameters: [
      { key: "intensity", label: "Intensity", type: "percent", min: 5, max: 100, default: 65, help: "Share of the channel's documented maximum strength." },
      { key: "budget", label: "Budget", type: "currency", min: 2_000_000, max: 200_000_000, default: 120_000_000, help: "Total programme cost." },
      { key: "duration", label: "Duration", type: "months", min: 3, max: 60, default: 24, help: "Months the transfer runs." },
    ],
    bnNodes: ["IncomeClass", "SpendingCapacity", "Inflation", "PublicSentiment", "ProtestRiskBand"],
    status: "implemented",
    directTargets: ["meanIncome", "happinessIndex"],
  },

  LABOR_MARKET: {
    id: "LABOR_MARKET",
    label: "Labour market / employment",
    summary: "Training, placement, wage support, job creation programmes.",
    keywords: ["employment", "jobs", "training", "placement", "skilling", "labour", "labor", "apprenticeship"],
    parameters: [
      { key: "intensity", label: "Intensity", type: "percent", min: 5, max: 100, default: 65, help: "Programme strength." },
      { key: "budget", label: "Budget", type: "currency", min: 2_000_000, max: 200_000_000, default: 120_000_000, help: "Total cost." },
      { key: "duration", label: "Duration", type: "months", min: 3, max: 60, default: 24, help: "Programme length." },
      { key: "trainingVsPlacementShare", label: "Training vs. placement mix", type: "share", min: 0, max: 1, default: 0.5, help: "0 = pure placement, 1 = pure training." },
    ],
    bnNodes: ["EmploymentStatus", "SectorDemand", "Inflation", "PublicSentiment"],
    status: "implemented",
    directTargets: ["employmentRatePct", "wageIndex"],
  },

  HOUSING: {
    id: "HOUSING",
    label: "Housing",
    summary: "Construction, upgrading, rent relief, tenure security.",
    keywords: ["housing", "dwelling", "rent", "slum", "construction", "shelter"],
    parameters: [
      { key: "intensity", label: "Intensity", type: "percent", min: 5, max: 100, default: 65, help: "Programme strength." },
      { key: "budget", label: "Budget", type: "currency", min: 2_000_000, max: 200_000_000, default: 120_000_000, help: "Total cost." },
      { key: "duration", label: "Duration", type: "months", min: 3, max: 60, default: 24, help: "Programme length." },
    ],
    bnNodes: ["HousingQuality", "HouseholdStress", "IncomeClass", "PublicSentiment"],
    status: "implemented",
    directTargets: ["happinessIndex", "gini"],
  },

  EDUCATION_SKILL: {
    id: "EDUCATION_SKILL",
    label: "Education / human capital",
    summary: "Schooling, vocational training, literacy, retraining.",
    keywords: ["education", "school", "skill", "literacy", "vocational", "scholarship", "curriculum"],
    parameters: [
      { key: "intensity", label: "Intensity", type: "percent", min: 5, max: 100, default: 65, help: "Programme strength." },
      { key: "budget", label: "Budget", type: "currency", min: 2_000_000, max: 200_000_000, default: 120_000_000, help: "Total cost." },
      { key: "duration", label: "Duration", type: "months", min: 3, max: 60, default: 24, help: "Programme length (effects carry a documented long lag)." },
    ],
    bnNodes: ["EducationLevel", "SkillRelevance", "EmploymentStatus"],
    status: "implemented",
    directTargets: ["gdpGrowthPct", "wageIndex"],
  },

  TAX_FISCAL: {
    id: "TAX_FISCAL",
    label: "Tax / fiscal policy",
    summary: "Rate changes, brackets, fiscal tightening or loosening.",
    keywords: ["tax", "levy", "duty", "bracket", "revenue", "fiscal"],
    parameters: [
      { key: "intensity", label: "Intensity", type: "percent", min: 5, max: 100, default: 65, help: "Size of the rate change." },
      { key: "duration", label: "Duration", type: "months", min: 3, max: 60, default: 24, help: "How long the change is in effect." },
    ],
    bnNodes: ["SpendingCapacity", "Inflation", "IncomeClass", "ProtestRiskBand"],
    status: "implemented",
    directTargets: ["inflationPct", "gini"],
  },

  REGULATION: {
    id: "REGULATION",
    label: "Regulation / compliance",
    summary: "Rules, enforcement, licensing, compliance deadlines.",
    keywords: ["regulation", "compliance", "enforcement", "licence", "license", "ban", "mandate", "penalty"],
    parameters: [
      { key: "intensity", label: "Intensity", type: "percent", min: 5, max: 100, default: 65, help: "Enforcement strength." },
      { key: "duration", label: "Duration", type: "months", min: 3, max: 60, default: 24, help: "How long enforced." },
    ],
    bnNodes: ["SectorDemand", "EmploymentStatus", "ProtestRiskBand"],
    status: "implemented",
    directTargets: ["protestRisk", "inflationPct"],
  },

  HEALTHCARE_ACCESS: {
    id: "HEALTHCARE_ACCESS",
    label: "Healthcare / insurance",
    summary: "Coverage expansion, premium subsidy, out-of-pocket relief.",
    keywords: ["health", "healthcare", "insurance", "hospital", "medical", "clinic", "coverage", "medicare", "medicaid"],
    parameters: [
      { key: "intensity", label: "Intensity", type: "percent", min: 5, max: 100, default: 65, help: "Programme strength." },
      { key: "budget", label: "Budget", type: "currency", min: 2_000_000, max: 200_000_000, default: 120_000_000, help: "Total cost." },
      { key: "coverageTarget", label: "Coverage target", type: "percent", min: 5, max: 100, default: 50, help: "Share of eligible population targeted." },
    ],
    bnNodes: ["HealthInsurance", "HealthBurden", "HouseholdStress", "IncomeClass"],
    status: "implemented", // HealthInsurance/HealthBurden exist in the node registry
    directTargets: ["happinessIndex", "meanIncome"],
  },

  // --- Declared, not yet implemented. Selecting one of these must show the
  // "not yet wired" warning below, never silently fall back to a generic
  // channel the way the original healthcare test run did. ---

  DIGITAL_ACCESS: {
    id: "DIGITAL_ACCESS",
    label: "Digital infrastructure / access",
    summary: "Internet access, digital ID, e-governance, connectivity.",
    keywords: ["digital", "internet", "broadband", "e-governance", "online", "connectivity", "id card", "aadhaar"],
    parameters: [
      { key: "intensity", label: "Intensity", type: "percent", min: 5, max: 100, default: 65, help: "Programme strength." },
      { key: "budget", label: "Budget", type: "currency", min: 2_000_000, max: 200_000_000, default: 80_000_000, help: "Total cost." },
    ],
    bnNodes: ["DigitalAccess", "SectorDemand", "PublicSentiment"],
    status: "declared",
    bnNodesPending: ["DigitalAccess"],
    directTargets: ["gdpGrowthPct"],
  },

  ENVIRONMENT_CLIMATE: {
    id: "ENVIRONMENT_CLIMATE",
    label: "Environment / climate",
    summary: "Emissions rules, green subsidy, disaster resilience.",
    keywords: ["climate", "environment", "pollution", "emission", "green", "renewable", "flood", "drought"],
    parameters: [
      { key: "intensity", label: "Intensity", type: "percent", min: 5, max: 100, default: 65, help: "Programme strength." },
      { key: "budget", label: "Budget", type: "currency", min: 2_000_000, max: 200_000_000, default: 80_000_000, help: "Total cost." },
    ],
    bnNodes: ["EnvironmentalQuality", "SectorDemand", "HealthBurden"],
    status: "declared",
    bnNodesPending: ["EnvironmentalQuality"],
    directTargets: ["happinessIndex"],
  },

  FOOD_SECURITY: {
    id: "FOOD_SECURITY",
    label: "Food security / agriculture",
    summary: "Price support, rationing, farm input subsidy.",
    keywords: ["food", "ration", "agriculture", "farm", "crop", "msp", "nutrition"],
    parameters: [
      { key: "intensity", label: "Intensity", type: "percent", min: 5, max: 100, default: 65, help: "Programme strength." },
      { key: "budget", label: "Budget", type: "currency", min: 2_000_000, max: 200_000_000, default: 80_000_000, help: "Total cost." },
    ],
    bnNodes: ["FoodSecurity", "IncomeClass", "HealthBurden"],
    status: "declared",
    bnNodesPending: ["FoodSecurity"],
    directTargets: ["happinessIndex", "gini"],
  },

  INFRASTRUCTURE: {
    id: "INFRASTRUCTURE",
    label: "Infrastructure (roads, water, power)",
    summary: "Physical infrastructure investment — roads, water supply, electricity reliability.",
    keywords: ["infrastructure", "road", "water", "electricity", "power", "sanitation", "sewage"],
    parameters: [
      { key: "intensity", label: "Intensity", type: "percent", min: 5, max: 100, default: 65, help: "Programme strength." },
      { key: "budget", label: "Budget", type: "currency", min: 2_000_000, max: 200_000_000, default: 150_000_000, help: "Total cost." },
      { key: "duration", label: "Duration", type: "months", min: 6, max: 60, default: 36, help: "Infrastructure builds carry a longer lag than cash transfers." },
    ],
    bnNodes: ["InfraAccess", "SectorDemand", "HealthBurden", "PublicSentiment"],
    status: "declared",
    // Field already exists in the population data (census.ts) — node still
    // needs defining in the node registry.
    bnNodesPending: ["InfraAccess"],
    directTargets: ["gdpGrowthPct", "happinessIndex"],
  },

  FINANCIAL_INCLUSION: {
    id: "FINANCIAL_INCLUSION",
    label: "Financial inclusion / credit access",
    summary: "Microfinance, banking access, formal credit for informal-sector workers.",
    keywords: ["credit", "loan", "microfinance", "banking", "bank account", "financial inclusion"],
    parameters: [
      { key: "intensity", label: "Intensity", type: "percent", min: 5, max: 100, default: 65, help: "Programme strength." },
      { key: "budget", label: "Budget", type: "currency", min: 2_000_000, max: 200_000_000, default: 100_000_000, help: "Total cost." },
    ],
    bnNodes: ["CreditAccess", "IncomeClass", "SpendingCapacity"],
    status: "declared",
    bnNodesPending: ["CreditAccess"],
    directTargets: ["meanIncome", "gini"],
  },
};

/** Every channel that is fully wired into the engine. */
export const IMPLEMENTED_CHANNELS: ChannelDefinition[] = Object.values(CHANNELS).filter(
  (c) => c.status === "implemented",
);

/** Every channel that is named but not yet wired; selecting one must warn. */
export const DECLARED_CHANNELS: ChannelDefinition[] = Object.values(CHANNELS).filter(
  (c) => c.status === "declared",
);

// ------------------------------------------------------ Policy composition

/** What a policy actually is now: a name, plus a confirmed set of channels. */
export interface ComposedPolicy {
  name: string;
  channelIds: string[];
  /** Union of every selected channel's parameters, de-duplicated by key. */
  parameters: ChannelParam[];
  /** Any selected channel that is only "declared" — surfaced so the UI can
   *  warn plainly rather than silently proceed as if it were implemented. */
  pendingWarnings: { channelId: string; missingNodes: string[] }[];
}

export function composePolicy(name: string, channelIds: string[]): ComposedPolicy {
  const seen = new Set<string>();
  const parameters: ChannelParam[] = [];
  const pendingWarnings: ComposedPolicy["pendingWarnings"] = [];

  for (const id of channelIds) {
    const ch = CHANNELS[id];
    if (!ch) continue;
    for (const p of ch.parameters) {
      if (!seen.has(p.key)) {
        seen.add(p.key);
        parameters.push(p);
      }
    }
    if (ch.status === "declared" && ch.bnNodesPending?.length) {
      pendingWarnings.push({ channelId: id, missingNodes: ch.bnNodesPending });
    }
  }

  return { name, channelIds, parameters, pendingWarnings };
}

// -------------------------------------------------- Classification (keyword tier)

/** Crude English suffix stripping, enough for "healthcare"/"medical" style
 *  matching without pulling in a full NLP library. */
function stem(word: string): string {
  for (const suffix of ["ically", "ically", "ations", "ation", "ings", "ing", "ies", "ical", "ity", "ness", "ment", "ed", "es", "s"]) {
    if (word.length > suffix.length + 3 && word.endsWith(suffix)) return word.slice(0, -suffix.length);
  }
  return word;
}

/** A small synonym table: extra terms that should surface a channel even when
 *  they share no keyword stem with it. */
const SYNONYMS: Record<string, string[]> = {
  HEALTHCARE_ACCESS: [
    "healthcare",
    "medical",
    "hospital",
    "medicare",
    "medicaid",
    "patient",
    "doctor",
    "physician",
    "surgery",
    "pharmacy",
    "medicine",
    "public health",
    "out-of-pocket",
  ],
  INCOME_SUPPORT: ["welfare", "benefit", "pension", "dole", "handout", "remittance"],
  LABOR_MARKET: ["unemployment", "unemployed", "workforce", "vocational", "recruitment", "hiring"],
  HOUSING: ["dwelling", "tenement", "eviction", "homeless", "real estate"],
  EDUCATION_SKILL: ["literacy", "schooling", "university", "tuition", "apprenticeship", "reskilling"],
  TAX_FISCAL: ["taxation", "revenue", "budgetary", "tariff", "gst"],
  REGULATION: ["rule", "standard", "licensing", "permitting", "inspection", "compliance"],
  INFRASTRUCTURE: ["roads", "highway", "pipeline", "electrification", "sewerage", "drainage"],
  FINANCIAL_INCLUSION: ["microfinance", "microcredit", "lending", "bank", "creditworthiness", "self-help group"],
  DIGITAL_ACCESS: ["broadband", "telecom", "digitisation", "digitization", "e-governance"],
  ENVIRONMENT_CLIMATE: ["emissions", "carbon", "pollution", "renewables", "climate resilience", "conservation"],
  FOOD_SECURITY: ["nutrition", "ration", "subsistence", "hunger", "agricultural", "irrigation"],
};

/**
 * Suggests channels for a free-text policy name using lightweight,
 * context-aware matching — stemming plus a synonym table. This NEVER
 * auto-applies a channel; it returns suggestions for the user to confirm or
 * edit. A more capable tier (the existing Jev / LLM decision-layer adapter,
 * already in decision.ts) can be slotted in ahead of this as an optional
 * upgrade — same contract, same "suggest, never silently decide" rule, since
 * that adapter already exists for exactly this kind of bounded, typed
 * classification task.
 *
 * A policy that matches NO channel returns an empty array. The caller must
 * say so plainly and show the full channel list for a human to pick — never
 * fall back silently to a generic/nearest-sounding channel.
 */
export function suggestChannels(policyName: string): string[] {
  const text = policyName.toLowerCase();
  // Stemmed words plus the raw text, so multi-word synonyms still match.
  const words = text.split(/[^a-z0-9]+/).filter(Boolean);
  const stems = new Set(words.map(stem));
  const matches: string[] = [];

  for (const ch of Object.values(CHANNELS)) {
    const keywordHit = ch.keywords.some((kw) => {
      const k = kw.toLowerCase();
      if (text.includes(k)) return true;
      return k.split(/\s+/).some((part) => stems.has(stem(part)));
    });
    const synonymHit = (SYNONYMS[ch.id] ?? []).some((syn) => {
      if (text.includes(syn)) return true;
      return syn.split(/\s+/).some((part) => stems.has(stem(part)));
    });
    if (keywordHit || synonymHit) matches.push(ch.id);
  }
  return matches;
}
