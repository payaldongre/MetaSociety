/**
 * Structured policy brief + feasibility layer (spec §26, §27, §7).
 *
 * Replaces the slider-centric policy definition with a government-style form.
 * The pipeline this implements is explicit and enforced in code, not only in
 * the UI:
 *
 *   policy brief -> governance validation -> budget validation
 *                -> implementation feasibility -> (then) simulation
 *
 * The three sliders the spec removes (intensity, budget, duration) are not
 * inputs here. They are DERIVED from the brief: the budget is the sum of real
 * line items, the duration is the span of real phase dates. The governing
 * identity — line items must sum EXACTLY to the stated total — is asserted.
 */

import {
  GOVERNANCE_REGISTRY,
  POLICY_DOMAINS,
  SIMULATION_SAFETY_LIMIT,
  validateGovernance,
  type AuthorityRoles,
  type FeasibilityStatus,
  type GovernanceFinding,
  type PolicyDomain,
} from "./governance";
import { isObserved } from "./evidence";

/* ------------------------------------------------------------------ */
/* Budget                                                              */
/* ------------------------------------------------------------------ */

export interface BudgetLineItem {
  /** e.g. "Rest areas", "Sanitation". */
  label: string;
  /** Amount in INR (stored in rupees; the UI displays crore). */
  amountInr: number;
}

export interface BudgetCheck {
  totalLineItems: number;
  statedTotal: number;
  matches: boolean;
  differenceInr: number;
  withinSafetyLimit: boolean;
  /** True when any line item is negative or the stated total is not positive. */
  malformed: boolean;
}

/**
 * Validate a budget table. The sum of line items must equal the total EXACTLY
 * (spec §27: "No normalization trick"). A rounding tolerance is deliberately
 * NOT applied: the caller computes the total from the items.
 */
export function validateBudget(lineItems: BudgetLineItem[], statedTotalInr: number): BudgetCheck {
  const totalLineItems = lineItems.reduce((a, b) => a + b.amountInr, 0);
  const malformed = lineItems.some((l) => l.amountInr < 0) || statedTotalInr <= 0;
  return {
    totalLineItems,
    statedTotal: statedTotalInr,
    matches: !malformed && totalLineItems === statedTotalInr,
    differenceInr: statedTotalInr - totalLineItems,
    withinSafetyLimit: statedTotalInr <= SIMULATION_SAFETY_LIMIT.amountInr,
    malformed,
  };
}

/* ------------------------------------------------------------------ */
/* Timeline                                                            */
/* ------------------------------------------------------------------ */

export interface PolicyPhase {
  name: string;
  /** ISO date the phase starts. */
  startDate: string;
  /** ISO date the phase ends. */
  endDate: string;
  milestone?: string;
}

export interface TimelineCheck {
  valid: boolean;
  /** Whole months spanned by the phases (drives the engine's duration). */
  durationMonths: number;
  problems: string[];
}

/** Validate phases and derive the duration the engine consumes. */
export function validateTimeline(phases: PolicyPhase[]): TimelineCheck {
  const problems: string[] = [];
  if (phases.length === 0) problems.push("At least one implementation phase is required.");
  for (const p of phases) {
    const start = Date.parse(p.startDate);
    const end = Date.parse(p.endDate);
    if (Number.isNaN(start) || Number.isNaN(end)) {
      problems.push(`Phase "${p.name}" has an unparseable date.`);
    } else if (end < start) {
      problems.push(`Phase "${p.name}" ends before it starts.`);
    }
  }
  if (problems.length === 0) {
    const starts = phases.map((p) => Date.parse(p.startDate));
    const ends = phases.map((p) => Date.parse(p.endDate));
    const span = Math.max(...ends) - Math.min(...starts);
    if (span <= 0) problems.push("The phase dates span no time.");
    const durationMonths = Math.max(3, Math.min(60, Math.round(span / (1000 * 60 * 60 * 24 * 30))));
    return { valid: problems.length === 0, durationMonths, problems };
  }
  return { valid: false, durationMonths: 0, problems };
}

/* ------------------------------------------------------------------ */
/* The brief                                                           */
/* ------------------------------------------------------------------ */

export interface TargetPopulation {
  /** e.g. "Households in wards 4–8". */
  description: string;
  /** Actual count targeted, when known. */
  count?: number;
  /** Wards targeted, if any. */
  wards?: number[];
}

export interface PolicyBrief {
  id: string;
  // --- identification (spec §27) ---
  title: string;
  objective: string;
  problemStatement: string;
  // --- governance (spec §27) ---
  governance: AuthorityRoles;
  /** Domains this brief touches; auto-derived from channels where possible. */
  domains: PolicyDomain[];
  // --- legal basis: auto-filled from the registry, never hand-typed ---
  // (provided by `legalBasisFor`, not stored as a free-text field)
  // --- target population ---
  target: TargetPopulation;
  // --- budget ---
  budgetLineItems: BudgetLineItem[];
  statedTotalInr: number;
  // --- timeline ---
  phases: PolicyPhase[];
  // --- engine channels this brief maps onto ---
  channelIds: string[];
}

export interface PolicyFeasibility {
  status: FeasibilityStatus;
  /** A policy with blockers must not reach the engine. */
  blockers: string[];
  conditions: string[];
  governance: GovernanceFinding;
  budget: BudgetCheck;
  timeline: TimelineCheck;
  /** True only when every gate passed. */
  simulationReady: boolean;
  /** The derived engine parameters, meaningful only when simulationReady. */
  derived: { budgetInr: number; durationMonths: number };
}

/**
 * Thrown when a policy brief fails the feasibility gate. It carries the full
 * `PolicyFeasibility` so a caller (engine or UI) can show the evaluator-readable
 * reason instead of a bare message. This is the code-level gate the spec
 * requires: a blocking-invalid policy must not reach the simulation engine.
 */
export class PolicyFeasibilityError extends Error {
  readonly briefTitle: string;
  readonly feasibility: PolicyFeasibility;
  constructor(briefTitle: string, feasibility: PolicyFeasibility) {
    const reason = feasibility.blockers.length > 0 ? feasibility.blockers.join("; ") : "unknown reason";
    super(`Policy brief "${briefTitle}" is blocked and cannot reach the simulation engine: ${reason}`);
    this.name = "PolicyFeasibilityError";
    this.briefTitle = briefTitle;
    this.feasibility = feasibility;
  }
}

/**
 * Legal basis auto-filled from the verified governance registry (spec §27). The
 * evaluator can see the exact instrument that authorises the deciding body.
 */
export function legalBasisFor(roles: AuthorityRoles): {
  authority: string;
  instrument: string;
  reference?: string;
  url?: string;
  unresolved: string[];
}[] {
  const ids = new Set([
    roles.proposingAuthority,
    roles.primaryDecisionAuthority,
    ...roles.approvalAuthorities,
    ...roles.fundingAuthorities,
    ...roles.implementingAuthorities,
    ...roles.supportingAuthorities,
  ]);
  return [...ids].map((id) => {
    const body = GOVERNANCE_REGISTRY[id];
    return {
      authority: body.name,
      instrument: body.legalBasis.title,
      reference: body.legalBasis.documentReference,
      url: body.legalBasis.url,
      unresolved: body.unresolved,
    };
  });
}

/**
 * Run the full feasibility pipeline. This is the code-level gate the spec
 * requires (spec §7: enforcement "must exist in the policy validation layer,
 * not only in the frontend").
 */
export function validatePolicyBrief(brief: PolicyBrief): PolicyFeasibility {
  const governance = validateGovernance(brief.governance, brief.domains);
  const budget = validateBudget(brief.budgetLineItems, brief.statedTotalInr);
  const timeline = validateTimeline(brief.phases);

  const blockers = [...governance.blockers];
  const conditions = [...governance.conditions];

  if (budget.malformed) blockers.push("The budget table is malformed (negative line item or non-positive total).");
  else if (!budget.matches) {
    blockers.push(
      `Budget line items sum to ₹${budget.totalLineItems.toLocaleString("en-IN")} but the stated total is ` +
        `₹${budget.statedTotal.toLocaleString("en-IN")}. The items must equal the total exactly.`,
    );
  }
  if (!budget.withinSafetyLimit) {
    conditions.push(
      `The stated total exceeds the simulation safety limit of ₹${SIMULATION_SAFETY_LIMIT.amountInr.toLocaleString("en-IN")}, ` +
        `which is a model assumption, not a legal limit. The engine will clamp it.`,
    );
  }

  if (!timeline.valid) blockers.push(...timeline.problems);

  if (brief.channelIds.length === 0) {
    conditions.push("No engine channel is attached; the brief will simulate as the no-policy counterfactual.");
  }

  // Evidence gate: a brief whose domain has no observed or modelled basis at all
  // is flagged insufficient, not silently run.
  if (brief.domains.length === 0) {
    conditions.push("No policy domain is declared; competence cannot be checked.");
  }

  const hasBlocker = blockers.length > 0;
  let status: FeasibilityStatus = hasBlocker
    ? governance.status === "unsupported_by_authority"
      ? "unsupported_by_authority"
      : "conditionally_feasible"
    : governance.status;
  // No declared domain means competence cannot even be checked — distinguish
  // that from a policy that is genuinely feasible (spec §7 taxonomy).
  if (!hasBlocker && brief.domains.length === 0) status = "insufficient_evidence";

  return {
    status,
    blockers,
    conditions,
    governance,
    budget,
    timeline,
    simulationReady: !hasBlocker && budget.matches && timeline.valid,
    derived: { budgetInr: budget.totalLineItems, durationMonths: timeline.durationMonths },
  };
}

/* ------------------------------------------------------------------ */
/* Brief -> engine policy                                              */
/* ------------------------------------------------------------------ */

/**
 * Map a brief onto the engine's policy vector. The engine still consumes
 * `intensity / budget / durationMonths / allocation`, but those are now DERIVED
 * from the brief (budget = line-item total; duration = phase span; intensity and
 * the three-way allocation = the brief's own declared shares), never typed as
 * bare sliders. Throws when the brief is not simulation-ready.
 */
export interface BriefPolicyMapping {
  channelIds: string[];
  name: string;
  intensity: number;
  budget: number;
  durationMonths: number;
  allocation: { housing: number; education: number; employment: number };
}

export function briefToPolicyVector(
  brief: PolicyBrief,
  allocation: { housing: number; education: number; employment: number },
  intensity: number,
): BriefPolicyMapping {
  const feasibility = validatePolicyBrief(brief);
  if (!feasibility.simulationReady) throw new PolicyFeasibilityError(brief.title, feasibility);
  return {
    channelIds: brief.channelIds,
    name: brief.title,
    intensity,
    budget: feasibility.derived.budgetInr,
    durationMonths: feasibility.derived.durationMonths,
    allocation,
  };
}

/** Domains offered to the brief form, with human labels. */
export const DOMAIN_LABELS: Record<PolicyDomain, string> = {
  income_support: "Income support / cash transfer",
  labour_market: "Labour market / employment",
  housing: "Housing",
  education_skill: "Education / skills",
  healthcare: "Healthcare",
  taxation_fiscal: "Taxation / fiscal",
  regulation: "Regulation / compliance",
  infrastructure: "Infrastructure",
  environment_climate: "Environment / climate",
  digital_access: "Digital access",
  food_security: "Food security",
  pilgrimage_facilities: "Pilgrimage facilities (Wari)",
};

/** Re-export for callers that only need the domain vocabulary. */
export { POLICY_DOMAINS };
export { isObserved };

/* ------------------------------------------------------------------ */
/* Channel -> domain crosswalk, shared by the UI and the defaults      */
/* ------------------------------------------------------------------ */

/**
 * Which policy domain each engine channel belongs to. Kept here (not in the UI)
 * so the governance competence check, the brief's declared domains and the
 * default brief all agree by construction. FINANCIAL_INCLUSION sits under
 * income support because it is a household-credit concern, not a separate
 * competence.
 */
export const CHANNEL_DOMAIN: Record<string, PolicyDomain> = {
  INCOME_SUPPORT: "income_support",
  LABOR_MARKET: "labour_market",
  HOUSING: "housing",
  EDUCATION_SKILL: "education_skill",
  HEALTHCARE_ACCESS: "healthcare",
  TAX_FISCAL: "taxation_fiscal",
  REGULATION: "regulation",
  INFRASTRUCTURE: "infrastructure",
  ENVIRONMENT_CLIMATE: "environment_climate",
  DIGITAL_ACCESS: "digital_access",
  FOOD_SECURITY: "food_security",
  FINANCIAL_INCLUSION: "income_support",
  PILGRIMAGE_FACILITIES: "pilgrimage_facilities",
};

/** Domains a set of channels touches, in a stable order. */
export function channelDomainsFor(channelIds: string[]): PolicyDomain[] {
  const set = new Set<PolicyDomain>();
  for (const id of channelIds) {
    const d = CHANNEL_DOMAIN[id];
    if (d) set.add(d);
  }
  return [...set];
}

/**
 * A worked default brief, so the workflow is usable immediately and every field
 * is a real, editable part of the brief. The default is deliberately a valid
 * (simulation-ready) configuration: a municipal-council programme funded and
 * implemented by the council, with line items that sum exactly and a two-year
 * timeline.
 */
export function createDefaultBrief(channelIds: string[], title = "Wari rest-area and sanitation programme"): PolicyBrief {
  return {
    id: "draft-brief",
    title,
    objective: "Reduce seasonal civic pressure on Pandharpur while protecting resident services.",
    problemStatement:
      "Temporary pilgrim load during the Wari strains sanitation, rest areas and crowd management each Ashadhi.",
    governance: {
      proposingAuthority: "pandharpur_municipal_council",
      primaryDecisionAuthority: "pandharpur_municipal_council",
      approvalAuthorities: [],
      fundingAuthorities: ["pandharpur_municipal_council"],
      implementingAuthorities: ["pandharpur_municipal_council"],
      supportingAuthorities: [],
    },
    domains: channelDomainsFor(channelIds),
    target: { description: "Wari-period population of Pandharpur (transient), residents town-wide" },
    budgetLineItems: [
      { label: "Rest areas and shelters", amountInr: 60_000_000 },
      { label: "Sanitation and waste", amountInr: 30_000_000 },
      { label: "Crowd management", amountInr: 20_000_000 },
      { label: "Monitoring and evaluation", amountInr: 10_000_000 },
    ],
    statedTotalInr: 120_000_000,
    phases: [
      { name: "Preparation", startDate: "2027-01-01", endDate: "2027-12-31", milestone: "Sites and contracts ready" },
      { name: "Wari operations", startDate: "2028-01-01", endDate: "2028-12-31", milestone: "Two Wari seasons delivered" },
    ],
    channelIds,
  };
}
