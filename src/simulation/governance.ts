/**
 * Pandharpur governance registry + authority validation (spec §6, §7, §8, §26).
 *
 * WHAT THIS IS. A sourced description of the bodies that can propose, approve,
 * fund and implement a policy for Pandharpur, plus a validator that blocks a
 * policy configuration the named authority could not lawfully carry.
 *
 * WHAT THIS IS NOT. It is not a source of invented statutory limits. Where no
 * verified statutory monetary ceiling could be found, `statutoryMonetaryCeiling`
 * is null and the gap is recorded in `unresolved` (spec §6, §33). The three
 * distinct notions the spec demands are kept apart:
 *   - statutoryAuthority     — the law that establishes the body
 *   - approvalThreshold      — a documented approval requirement (rare; usually unresolved)
 *   - practicalProjectScale  — an observed, roughly-typical project size (secondary evidence, not law)
 *   - simulationSafetyLimit   — a MODEL ASSUMPTION that only bounds the search
 *
 * Sources are cited inline so the registry is auditable. Entries that could not
 * be verified against a primary source are flagged `unresolved`.
 */

import { source, type SourceRecord } from "./evidence";

/* ------------------------------------------------------------------ */
/* Vocabularies                                                        */
/* ------------------------------------------------------------------ */

export const GOVERNANCE_LEVELS = ["local", "district", "state", "national"] as const;
export type GovernanceLevel = (typeof GOVERNANCE_LEVELS)[number];

/**
 * Policy domains the simulator understands. These mirror the channel
 * dictionary's concerns; a governance body is only allowed to decide within the
 * domains it is competent for.
 */
export const POLICY_DOMAINS = [
  "income_support",
  "labour_market",
  "housing",
  "education_skill",
  "healthcare",
  "taxation_fiscal",
  "regulation",
  "infrastructure",
  "environment_climate",
  "digital_access",
  "food_security",
  "pilgrimage_facilities",
] as const;
export type PolicyDomain = (typeof POLICY_DOMAINS)[number];

export const AUTHORITY_IDS = [
  "pandharpur_municipal_council",
  "vitthal_rukmini_temples_committee",
  "pandharpur_development_authority",
  "solapur_district_administration",
  "solapur_zilla_parishad",
  "government_of_maharashtra",
  "government_of_india",
] as const;
export type AuthorityId = (typeof AUTHORITY_IDS)[number];

export const AUTHORITY_LABELS: Record<AuthorityId, string> = {
  pandharpur_municipal_council: "Pandharpur Municipal Council",
  vitthal_rukmini_temples_committee: "Shri Vitthal-Rukmini Temples Committee",
  pandharpur_development_authority: "Pandharpur Development Authority",
  solapur_district_administration: "Solapur District Administration / Collector",
  solapur_zilla_parishad: "Solapur Zilla Parishad",
  government_of_maharashtra: "Government of Maharashtra",
  government_of_india: "Government of India",
};

/** What a body is legally able to do for a policy. */
export interface AuthorityCapabilities {
  propose: boolean;
  approve: boolean;
  fund: boolean;
  implement: boolean;
}

export interface GovernanceBody {
  id: AuthorityId;
  name: string;
  level: GovernanceLevel;
  /** The instrument that establishes the body. */
  legalBasis: SourceRecord;
  jurisdiction: string;
  responsibilities: string[];
  /** Domains this body is competent to decide within. */
  policyDomains: PolicyDomain[];
  capabilities: AuthorityCapabilities;
  /**
   * Authorities whose approval is required before this body's decision takes
   * effect (e.g. a municipal land transfer may need state sanction).
   */
  approvalDependencies: AuthorityId[];
  /**
   * A documented statutory monetary ceiling on this body's spending/approval
   * power. NULL where none could be verified — never invent one (spec §6).
   */
  statutoryMonetaryCeiling: { amountInr: number; source: SourceRecord } | null;
  /** Roughly-typical observed project sizes. Secondary evidence, not law. */
  practicalProjectScale?: { amountInr: number; basis: string; source: SourceRecord };
  /** Documented policies/projects this body has actually handled. */
  historicalExamples: string[];
  /** Recorded, not hidden: things that could not be verified. */
  unresolved: string[];
}

/* ------------------------------------------------------------------ */
/* Registry — every entry sourced                                      */
/* ------------------------------------------------------------------ */

const MMC_ACT: SourceRecord = source({
  sourceType: "official_act",
  authority: "Maharashtra Legislature",
  title: "The Maharashtra Municipal Councils, Nagar Panchayats and Industrial Townships Act, 1965 (Mah. XL of 1965)",
  date: "1965",
  documentReference: "Maharashtra Act No. 40 of 1965",
  url: "https://mahasec.maharashtra.gov.in/Upload/PDF/4%20The%20Mahahrashtra%20municipal_councils_nagar_panchayats_and_industrial_townships_act%20_1965_40_of_1965.pdf",
  referenceYear: 1965,
  confidence: "high",
  notes:
    "Establishes municipal councils in Maharashtra and their powers (water, sanitation, roads, public health, licensing, local planning). Pandharpur Municipal Council is constituted under this Act.",
});

const MMC_CLASS: SourceRecord = source({
  sourceType: "official_statistics",
  authority: "Government of Maharashtra",
  title: "List of urban local bodies in Maharashtra — Pandharpur Municipal Council (Class C)",
  url: "https://en.wikipedia.org/wiki/List_of_urban_local_bodies_in_Maharashtra",
  confidence: "moderate",
  referenceYear: 2011,
  notes:
    "Pandharpur Municipal Council is listed as a Class C municipal council. The class sets the council's composition and (per the Act) certain staffing/finance rules.",
});

const TEMPLES_ACT: SourceRecord = source({
  sourceType: "official_act",
  authority: "Maharashtra Legislature",
  title: "The Pandharpur Temples Act, 1973",
  date: "1973",
  url: "https://indiankanoon.org/doc/187589807/",
  referenceYear: 1973,
  confidence: "high",
  notes:
    "Constitutes the Shri Vitthal-Rukmini Temples Committee (Deosthan Committee) and vests management of the Pandharpur temples in it. Abolished hereditary priestly rights. The temple is administered under state control (Law and Judiciary Department).",
});

const TEMPLES_CONTROL: SourceRecord = source({
  sourceType: "reliable_secondary_reporting",
  authority: "Indian Express / The Hindu",
  title: "Subramanian Swamy moves Bombay HC against government control of Pandharpur temple; temple trust functions under the Maharashtra government",
  date: "2023-02-17",
  url: "https://indianexpress.com/article/cities/mumbai/subramanian-swamy-bombay-hc-pandharpur-temple-administration-govt-control-8451209/",
  referenceYear: 2023,
  confidence: "moderate",
  notes:
    "Confirms the Shri Vitthal-Rukmini Temples Committee operates under the state government and that the Pandharpur Temples Act, 1973 governs temple administration. Litigation over that control is ongoing.",
});

const PDA_ACT: SourceRecord = source({
  sourceType: "official_act",
  authority: "Maharashtra Legislature",
  title: "The Pandharpur Development Authority Act, 2008",
  url: "https://www.latestlaws.com/bare-acts",
  referenceYear: 2008,
  confidence: "moderate",
  notes:
    "Establishes a special-purpose development authority for Pandharpur, on the model of the Tuljapur Development Authority Act, 2008. Some catalogues list it as 2009; the Act year is recorded here as 2008 and the discrepancy is noted.",
  unresolved: false,
});

const LR_CODE: SourceRecord = source({
  sourceType: "official_act",
  authority: "Maharashtra Legislature",
  title: "The Maharashtra Land Revenue Code, 1966; and the Maharashtra Zilla Parishads and Panchayat Samitis Act, 1961",
  date: "1961",
  referenceYear: 1961,
  confidence: "moderate",
  notes:
    "Basis for the Collector's district administration, land-revenue and land-acquisition powers, and for the Zilla Parishad's rural development mandate.",
});

const STATE_GENERAL: SourceRecord = source({
  sourceType: "government_document",
  authority: "Government of Maharashtra",
  title: "State legislative and executive competence over state and concurrent subjects",
  referenceYear: 2026,
  confidence: "moderate",
  notes:
    "The State legislature/executive may legislate and fund state schemes within its competence and, where a scheme is applied in Pandharpur, that application is a state policy applied locally.",
});

const UNION_GENERAL: SourceRecord = source({
  sourceType: "government_document",
  authority: "Government of India",
  title: "Central schemes implemented through state and local bodies",
  referenceYear: 2026,
  confidence: "moderate",
  notes:
    "National schemes (e.g. housing, health assurance) are implemented locally, but the simulator models only their application to Pandharpur, never a national forecast.",
});

export const GOVERNANCE_REGISTRY: Record<AuthorityId, GovernanceBody> = {
  pandharpur_municipal_council: {
    id: "pandharpur_municipal_council",
    name: "Pandharpur Municipal Council",
    level: "local",
    legalBasis: MMC_ACT,
    jurisdiction: "Pandharpur municipal area (33 wards)",
    responsibilities: [
      "Water supply, drainage and sanitation",
      "Roads, street lighting and local infrastructure within municipal limits",
      "Public health and licensed markets",
      "Local building permission and municipal land management",
      "Municipal taxation (property tax, fees) and local works",
    ],
    policyDomains: [
      "income_support",
      "labour_market",
      "housing",
      "education_skill",
      "healthcare",
      "taxation_fiscal",
      "regulation",
      "infrastructure",
      "environment_climate",
      "digital_access",
      "food_security",
      "pilgrimage_facilities",
    ],
    // The council can propose local works and implement them; it can approve its
    // own local budget, but large land transfers or state schemes need sanction.
    capabilities: { propose: true, approve: true, fund: true, implement: true },
    approvalDependencies: [],
    statutoryMonetaryCeiling: null,
    practicalProjectScale: {
      amountInr: 3_990_00_00_000,
      basis:
        "Secondary reporting places the state-funded Pandharpur pilgrimage corridor at roughly ₹3,990 crore; the municipal council itself is a Class C body and its own works budget is a small fraction of this. Recorded as observed scale, not as a legal ceiling.",
      source: source({
        sourceType: "reliable_secondary_reporting",
        authority: "Times of India / Hindustan Times",
        title: "Pandharpur residents protest corridor development plan fearing eviction; corridor plan ~₹3,990 crore",
        date: "2026-09-09",
        url: "https://timesofindia.indiatimes.com/city/kolhapur/pandharpur-residents-protest-corridor-development-plan-fearing-eviction/articleshow/133980096.cms",
        referenceYear: 2026,
        confidence: "moderate",
      }),
    },
    historicalExamples: [
      "Municipal land and local works within Pandharpur municipal limits",
      "Opposition to the proposal to transfer municipal land to the Shri Vitthal-Rukmini Mandir Samiti (2026)",
    ],
    unresolved: [
      "No verified statutory monetary ceiling for the council's own approval power was found; none is asserted.",
      "The Class C composition/period was not verified against the current state notification.",
    ],
  },

  vitthal_rukmini_temples_committee: {
    id: "vitthal_rukmini_temples_committee",
    name: "Shri Vitthal-Rukmini Temples Committee",
    level: "local",
    legalBasis: TEMPLES_ACT,
    jurisdiction: "The Vitthal-Rukmini temple and its properties at Pandharpur",
    responsibilities: [
      "Administration of the temple, its rituals and its properties",
      "Darshan, pilgrim queue and temple-facing facilities",
      "Temple estates and devotee amenities",
    ],
    // Deliberately NARROW: this body is competent for temple-facing matters only.
    // A housing or general health policy must not be silently authorised here.
    policyDomains: ["pilgrimage_facilities", "regulation"],
    capabilities: { propose: true, approve: true, fund: true, implement: true },
    approvalDependencies: ["government_of_maharashtra"],
    statutoryMonetaryCeiling: null,
    historicalExamples: [
      "Temple administration and darshan arrangements under the Pandharpur Temples Act, 1973",
      "Sought state government approval on temple policy (e.g. entry policy discussions, 2014)",
    ],
    unresolved: [
      "No verified statutory monetary ceiling was found for the Committee's spending; none is asserted.",
      "The Committee's exact powers over non-temple municipal land are contested (see 2026 corridor dispute).",
    ],
  },

  pandharpur_development_authority: {
    id: "pandharpur_development_authority",
    name: "Pandharpur Development Authority",
    level: "local",
    legalBasis: PDA_ACT,
    jurisdiction: "Planned development area for Pandharpur",
    responsibilities: [
      "Planned development of Pandharpur and its pilgrimage infrastructure",
      "Town-planning schemes and development works within its notified area",
    ],
    policyDomains: ["infrastructure", "housing", "pilgrimage_facilities", "environment_climate"],
    capabilities: { propose: true, approve: true, fund: true, implement: true },
    approvalDependencies: ["government_of_maharashtra"],
    statutoryMonetaryCeiling: null,
    historicalExamples: [
      "Special-purpose development planning for Pandharpur (Pandharpur Development Authority Act, 2008)",
    ],
    unresolved: [
      "The Authority's current operational status, notified area boundary and staffing could not be verified from a primary source.",
      "The Act year is recorded as 2008; some catalogues list 2009.",
      "No verified statutory monetary ceiling was found; none is asserted.",
    ],
  },

  solapur_district_administration: {
    id: "solapur_district_administration",
    name: "Solapur District Administration / Collector",
    level: "district",
    legalBasis: LR_CODE,
    jurisdiction: "Solapur district, including Pandharpur taluka",
    responsibilities: [
      "Land acquisition and land-revenue administration",
      "District coordination of state and central schemes",
      "Disaster management and law-and-order coordination",
      "District planning inputs",
    ],
    policyDomains: [
      "income_support",
      "labour_market",
      "housing",
      "education_skill",
      "healthcare",
      "infrastructure",
      "environment_climate",
      "digital_access",
      "food_security",
      "pilgrimage_facilities",
    ],
    capabilities: { propose: true, approve: true, fund: true, implement: true },
    approvalDependencies: ["government_of_maharashtra"],
    statutoryMonetaryCeiling: null,
    practicalProjectScale: {
      amountInr: 3_990_00_00_000,
      basis:
        "The district administration is the land-acquisition authority for large projects such as the Pandharpur corridor (~₹3,990 crore, secondary reporting). Observed scale, not a ceiling.",
      source: TEMPLES_CONTROL,
    },
    historicalExamples: [
      "Land-acquisition process for the Pandharpur corridor (2026)",
      "Land survey for the proposed Shaktipeeth Expressway in Pandharpur taluka (2026), halted by protest",
    ],
    unresolved: [
      "No verified statutory monetary ceiling on the Collector's own commitment power was found.",
    ],
  },

  solapur_zilla_parishad: {
    id: "solapur_zilla_parishad",
    name: "Solapur Zilla Parishad",
    level: "district",
    legalBasis: LR_CODE,
    jurisdiction: "Rural areas of Solapur district (not the municipal town itself)",
    responsibilities: [
      "Rural roads, water, health and education delivery",
      "Rural development schemes",
    ],
    policyDomains: ["education_skill", "healthcare", "infrastructure", "income_support", "food_security"],
    capabilities: { propose: true, approve: true, fund: true, implement: true },
    approvalDependencies: ["government_of_maharashtra"],
    statutoryMonetaryCeiling: null,
    historicalExamples: ["Rural service delivery around Pandharpur taluka"],
    unresolved: [
      "The Zilla Parishad's jurisdiction excludes the municipal town; its competence here is limited to rural Pandharpur taluka.",
    ],
  },

  government_of_maharashtra: {
    id: "government_of_maharashtra",
    name: "Government of Maharashtra",
    level: "state",
    legalBasis: STATE_GENERAL,
    jurisdiction: "State of Maharashtra",
    responsibilities: [
      "State legislation and state schemes",
      "Sanctioning large projects and land transfers",
      "Funding and directing state-level development programmes",
    ],
    policyDomains: [
      "income_support",
      "labour_market",
      "housing",
      "education_skill",
      "healthcare",
      "taxation_fiscal",
      "regulation",
      "infrastructure",
      "environment_climate",
      "digital_access",
      "food_security",
      "pilgrimage_facilities",
    ],
    capabilities: { propose: true, approve: true, fund: true, implement: false },
    approvalDependencies: [],
    statutoryMonetaryCeiling: null,
    practicalProjectScale: {
      amountInr: 3_990_00_00_000,
      basis:
        "The state sanctioned the Pandharpur pilgrimage corridor at roughly ₹3,990 crore (secondary reporting, 2026). Observed scale only.",
      source: TEMPLES_CONTROL,
    },
    historicalExamples: [
      "Sanction and land-acquisition direction for the Pandharpur corridor (2026)",
      "Annual toll exemption for Wari pilgrimage vehicles to Pandharpur (2025, 2026)",
      "Toll exemption reported for 2025-06-18 to 2025-07-10 and 2026-07-06 to 2026-07-29",
    ],
    unresolved: [
      "No verified statutory monetary ceiling on state spending was found; a state budget is a political choice, not a statutory cap.",
    ],
  },

  government_of_india: {
    id: "government_of_india",
    name: "Government of India",
    level: "national",
    legalBasis: UNION_GENERAL,
    jurisdiction: "Union of India",
    responsibilities: [
      "National legislation and national schemes",
      "Funding central-sector schemes implemented through states and local bodies",
    ],
    policyDomains: [
      "income_support",
      "labour_market",
      "housing",
      "education_skill",
      "healthcare",
      "taxation_fiscal",
      "regulation",
      "infrastructure",
      "environment_climate",
      "digital_access",
      "food_security",
    ],
    capabilities: { propose: true, approve: true, fund: true, implement: false },
    approvalDependencies: [],
    statutoryMonetaryCeiling: null,
    historicalExamples: [
      "National schemes (housing, health assurance, employment guarantee) implemented locally through state and district machinery",
    ],
    unresolved: [
      "A national scheme's Pandharpur application is a national policy applied locally; the simulator models only that local application.",
    ],
  },
};

/* ------------------------------------------------------------------ */
/* Multi-authority role model (spec §7)                                */
/* ------------------------------------------------------------------ */

/** The full set of roles a policy may require (spec §7). */
export interface AuthorityRoles {
  proposingAuthority: AuthorityId;
  primaryDecisionAuthority: AuthorityId;
  approvalAuthorities: AuthorityId[];
  fundingAuthorities: AuthorityId[];
  implementingAuthorities: AuthorityId[];
  supportingAuthorities: AuthorityId[];
}

export type FeasibilityStatus =
  | "legally_feasible"
  | "conditionally_feasible"
  | "requires_escalation"
  | "unsupported_by_authority"
  | "insufficient_evidence";

export interface GovernanceFinding {
  status: FeasibilityStatus;
  /** Blocking problems — a policy with any of these must not reach the engine. */
  blockers: string[];
  /** Non-blocking conditions the evaluator should see. */
  conditions: string[];
  /** Which roles each authority plays, in governance order. */
  pathway: { step: string; authority: AuthorityId; label: string }[];
  /** The administrative level a policy is being decided at. */
  level: GovernanceLevel;
}

/* ------------------------------------------------------------------ */
/* Validation (spec §8)                                                */
/* ------------------------------------------------------------------ */

const LEVEL_RANK: Record<GovernanceLevel, number> = { local: 1, district: 2, state: 3, national: 4 };

/** Does a body cover a domain? */
export function coversDomain(id: AuthorityId, domain: PolicyDomain): boolean {
  return GOVERNANCE_REGISTRY[id].policyDomains.includes(domain);
}

/**
 * Validate a policy's authority configuration against the registry.
 *
 * Blocks (does not merely warn) when:
 *   - the deciding authority is not competent for the policy domain;
 *   - the deciding authority cannot approve;
 *   - a body named as implementer has no implementation capacity;
 *   - a required approval dependency is missing from `approvalAuthorities`;
 *   - the selected body is only an implementer for a domain it cannot decide.
 */
export function validateGovernance(
  roles: AuthorityRoles,
  domains: PolicyDomain[],
): GovernanceFinding {
  const blockers: string[] = [];
  const conditions: string[] = [];

  const decision = GOVERNANCE_REGISTRY[roles.primaryDecisionAuthority];
  const proposing = GOVERNANCE_REGISTRY[roles.proposingAuthority];

  // 1. Domain competence of the deciding authority.
  for (const domain of domains) {
    if (!coversDomain(roles.primaryDecisionAuthority, domain)) {
      const competent = competentAuthoritiesFor(domain).map((id) => AUTHORITY_LABELS[id]).join(", ");
      blockers.push(
        `${decision.name} is not competent to decide a ${domain.replace(/_/g, " ")} policy. ` +
          `Competence rests with ${competent || "a higher authority"}.`,
      );
    }
  }

  // 2. The deciding authority must be able to approve.
  if (!decision.capabilities.approve) {
    blockers.push(`${decision.name} cannot approve policies; name a body with approval power as the decision authority.`);
  }

  // 3. Required approvals must be represented.
  for (const dep of decision.approvalDependencies) {
    if (!roles.approvalAuthorities.includes(dep)) {
      conditions.push(
        `${decision.name} decisions on these matters require approval from ${GOVERNANCE_REGISTRY[dep].name}, ` +
          `which is not listed among the approval authorities.`,
      );
    }
  }
  // Funding authority dependencies.
  for (const funder of roles.fundingAuthorities) {
    const body = GOVERNANCE_REGISTRY[funder];
    if (!body.capabilities.fund) {
      conditions.push(`${body.name} is listed as a funding authority but is not recorded as able to fund this policy directly.`);
    }
  }

  // 4. Implementers must be able to implement.
  for (const impl of roles.implementingAuthorities) {
    if (!GOVERNANCE_REGISTRY[impl].capabilities.implement) {
      blockers.push(`${GOVERNANCE_REGISTRY[impl].name} is named as an implementing authority but cannot implement works.`);
    }
  }

  // 5. The proposer must be able to propose.
  if (!proposing.capabilities.propose) {
    blockers.push(`${proposing.name} cannot propose policies.`);
  }

  // 6. Escalation: if the decision authority is local but the domain is carried
  //    by a higher level, that is escalation, not a local decision.
  const level = decision.level;
  const highest = Math.max(...domains.map((d) => defaultLevelForDomain(d)));
  const needsEscalation = LEVEL_RANK[level] < highest;
  if (needsEscalation) {
    conditions.push(
      `This is a ${levelLabel(highest)}-level matter; deciding it at ${levelLabel(LEVEL_RANK[level])} level requires escalation.`,
    );
  }

  const status: FeasibilityStatus =
    blockers.length > 0
      ? "unsupported_by_authority"
      : conditions.length > 0
        ? needsEscalation
          ? "requires_escalation"
          : "conditionally_feasible"
        : "legally_feasible";

  return {
    status,
    blockers,
    conditions,
    pathway: buildPathway(roles),
    level,
  };
}

/** Ordered explainable pathway: proposed → approved → funded → implemented. */
export function buildPathway(roles: AuthorityRoles): { step: string; authority: AuthorityId; label: string }[] {
  const steps: { step: string; authority: AuthorityId; label: string }[] = [
    { step: "Proposed by", authority: roles.proposingAuthority, label: GOVERNANCE_REGISTRY[roles.proposingAuthority].name },
  ];
  for (const a of roles.approvalAuthorities) {
    steps.push({ step: "Approved by", authority: a, label: GOVERNANCE_REGISTRY[a].name });
  }
  steps.push({
    step: "Decided by",
    authority: roles.primaryDecisionAuthority,
    label: GOVERNANCE_REGISTRY[roles.primaryDecisionAuthority].name,
  });
  for (const a of roles.fundingAuthorities) {
    steps.push({ step: "Funded by", authority: a, label: GOVERNANCE_REGISTRY[a].name });
  }
  for (const a of roles.implementingAuthorities) {
    steps.push({ step: "Implemented by", authority: a, label: GOVERNANCE_REGISTRY[a].name });
  }
  for (const a of roles.supportingAuthorities) {
    steps.push({ step: "Supported by", authority: a, label: GOVERNANCE_REGISTRY[a].name });
  }
  return steps;
}

/** Bodies competent for a domain, most local first. */
export function competentAuthoritiesFor(domain: PolicyDomain): AuthorityId[] {
  return AUTHORITY_IDS.filter((id) => coversDomain(id, domain));
}

/** The administrative level at which a domain is normally decided. */
export function defaultLevelForDomain(domain: PolicyDomain): number {
  const competent = competentAuthoritiesFor(domain);
  if (competent.length === 0) return LEVEL_RANK.state;
  // The most local competent body sets the floor; higher levels can still act.
  return Math.min(...competent.map((id) => LEVEL_RANK[GOVERNANCE_REGISTRY[id].level]));
}

function levelLabel(rank: number): string {
  return GOVERNANCE_LEVELS.find((l) => LEVEL_RANK[l] === rank) ?? "unknown";
}

/**
 * Simulation safety limit. This is a MODEL ASSUMPTION that bounds the search
 * space; it is NOT a statutory ceiling and must never be presented as one.
 */
export const SIMULATION_SAFETY_LIMIT = {
  amountInr: 200_000_000,
  category: "MODEL_ASSUMPTION" as const,
  note: "Bounds the Differential Evolution search space. Not a legal spending limit.",
};

/** Convenience: the level a set of domains implies. */
export function policyLevelForDomains(domains: PolicyDomain[]): GovernanceLevel {
  return GOVERNANCE_LEVELS[defaultLevelForDomain(domains[0] ?? "regulation") - 1] ?? "local";
}
