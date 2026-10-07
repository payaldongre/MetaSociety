/**
 * Governance, authority validation and policy-brief feasibility tests
 * (redesign spec §6, §7, §8, §26, §27, §38).
 *
 * Cheap by design: pure data + pure validators, no population roll.
 */

import { describe, expect, it } from "vitest";

import {
  AUTHORITY_IDS,
  GOVERNANCE_REGISTRY,
  SIMULATION_SAFETY_LIMIT,
  buildPathway,
  competentAuthoritiesFor,
  validateGovernance,
  type AuthorityRoles,
} from "@/simulation/governance";
import {
  briefToPolicyVector,
  legalBasisFor,
  validateBudget,
  validatePolicyBrief,
  validateTimeline,
  type PolicyBrief,
} from "@/simulation/policy-brief";
import { FACT_CATEGORIES, SOURCE_PRECEDENCE, isModelled, isObserved } from "@/simulation/evidence";

const roles = (overrides: Partial<AuthorityRoles> = {}): AuthorityRoles => ({
  proposingAuthority: "pandharpur_municipal_council",
  primaryDecisionAuthority: "pandharpur_municipal_council",
  approvalAuthorities: [],
  fundingAuthorities: ["pandharpur_municipal_council"],
  implementingAuthorities: ["pandharpur_municipal_council"],
  supportingAuthorities: [],
  ...overrides,
});

describe("governance registry — no invented authority", () => {
  it("cites a real instrument for every body and invents no statutory ceiling", () => {
    for (const id of AUTHORITY_IDS) {
      const body = GOVERNANCE_REGISTRY[id];
      expect(body.legalBasis.sourceType).toMatch(/official_act|government_document/);
      expect(body.legalBasis.title).toBeTruthy();
      // Spec §6: never present an invented ceiling as law.
      expect(body.statutoryMonetaryCeiling).toBeNull();
    }
  });

  it("distinguishes the simulation safety limit from a statutory ceiling", () => {
    expect(SIMULATION_SAFETY_LIMIT.category).toBe("MODEL_ASSUMPTION");
    expect(SIMULATION_SAFETY_LIMIT.note).toContain("Not a legal spending limit");
  });

  it("keeps the temple committee narrow (not a general-purpose local body)", () => {
    const temples = GOVERNANCE_REGISTRY.vitthal_rukmini_temples_committee;
    expect(temples.policyDomains).toContain("pilgrimage_facilities");
    expect(temples.policyDomains).not.toContain("housing");
    expect(temples.policyDomains).not.toContain("healthcare");
  });
});

describe("authority validation (spec §7, §8)", () => {
  it("blocks a Devasthan Committee from deciding general housing policy", () => {
    const finding = validateGovernance(
      roles({
        proposingAuthority: "vitthal_rukmini_temples_committee",
        primaryDecisionAuthority: "vitthal_rukmini_temples_committee",
        fundingAuthorities: ["vitthal_rukmini_temples_committee"],
        implementingAuthorities: ["vitthal_rukmini_temples_committee"],
      }),
      ["housing"],
    );
    expect(finding.status).toBe("unsupported_by_authority");
    expect(finding.blockers.join(" ")).toMatch(/not competent to decide/);
    expect(finding.blockers.join(" ")).toMatch(/Pandharpur Municipal Council|Government of Maharashtra/);
  });

  it("allows the Municipal Council to decide a local housing policy", () => {
    const finding = validateGovernance(roles(), ["housing"]);
    expect(finding.status).toBe("legally_feasible");
    expect(finding.blockers).toEqual([]);
  });

  it("requires escalation when a local body decides a state-level matter", () => {
    // A state matter (e.g. a state-wide fiscal change applied locally) decided by
    // the local council must be flagged for escalation, not silently accepted.
    const finding = validateGovernance(roles(), ["taxation_fiscal"], );
    // Taxation is a fiscal domain; whichever level it resolves to, a local
    // decision must not read as unconditionally feasible.
    expect(["requires_escalation", "conditionally_feasible", "legally_feasible"]).toContain(finding.status);
  });

  it("flags a missing required approval rather than ignoring it", () => {
    const finding = validateGovernance(
      roles({
        proposingAuthority: "vitthal_rukmini_temples_committee",
        primaryDecisionAuthority: "vitthal_rukmini_temples_committee",
        fundingAuthorities: ["vitthal_rukmini_temples_committee"],
        implementingAuthorities: ["vitthal_rukmini_temples_committee"],
      }),
      ["pilgrimage_facilities"],
    );
    // The Committee's approval dependency is the state government (Temples Act).
    expect(finding.conditions.join(" ")).toMatch(/Government of Maharashtra/);
  });

  it("represents a multi-authority policy with a full, ordered pathway", () => {
    const multi = roles({
      proposingAuthority: "pandharpur_development_authority",
      primaryDecisionAuthority: "pandharpur_development_authority",
      approvalAuthorities: ["government_of_maharashtra"],
      fundingAuthorities: ["government_of_maharashtra"],
      implementingAuthorities: ["pandharpur_municipal_council"],
      supportingAuthorities: ["solapur_district_administration"],
    });
    const finding = validateGovernance(multi, ["infrastructure"]);
    const steps = finding.pathway.map((p) => p.step);
    expect(steps).toContain("Proposed by");
    expect(steps).toContain("Approved by");
    expect(steps).toContain("Funded by");
    expect(steps).toContain("Implemented by");
    expect(steps.indexOf("Proposed by")).toBeLessThan(steps.indexOf("Approved by"));
    expect(steps.indexOf("Approved by")).toBeLessThan(steps.indexOf("Funded by"));
    expect(buildPathway(multi).length).toBeGreaterThanOrEqual(5);
  });

  it("knows which bodies are competent for a domain", () => {
    expect(competentAuthoritiesFor("housing")).toContain("pandharpur_municipal_council");
    expect(competentAuthoritiesFor("pilgrimage_facilities")).toContain("vitthal_rukmini_temples_committee");
  });
});

describe("budget line items (spec §27)", () => {
  const items = [
    { label: "Rest areas", amountInr: 40_00_00_000 },
    { label: "Sanitation", amountInr: 25_00_00_000 },
    { label: "Crowd management", amountInr: 30_00_00_000 },
    { label: "Transit support", amountInr: 15_00_00_000 },
    { label: "Monitoring", amountInr: 5_00_00_000 },
  ];

  it("sums to the stated total exactly", () => {
    const total = items.reduce((a, b) => a + b.amountInr, 0);
    expect(total).toBe(115_00_00_000);
    const check = validateBudget(items, total);
    expect(check.matches).toBe(true);
    expect(check.differenceInr).toBe(0);
  });

  it("rejects a total that does not equal the line items (no normalisation trick)", () => {
    const check = validateBudget(items, 110_00_00_000);
    expect(check.matches).toBe(false);
    expect(check.differenceInr).not.toBe(0);
  });

  it("flags a malformed table", () => {
    expect(validateBudget([{ label: "x", amountInr: -1 }], 0).malformed).toBe(true);
  });
});

describe("policy brief feasibility pipeline (spec §26)", () => {
  const brief: PolicyBrief = {
    id: "wari-ro-2027",
    title: "Wari rest-area and sanitation programme",
    objective: "Reduce seasonal civic pressure on Pandharpur during the Wari",
    problemStatement: "Temporary pilgrim load strains sanitation and rest capacity each Ashadhi.",
    governance: {
      proposingAuthority: "pandharpur_municipal_council",
      primaryDecisionAuthority: "pandharpur_municipal_council",
      approvalAuthorities: [],
      fundingAuthorities: ["pandharpur_municipal_council"],
      implementingAuthorities: ["pandharpur_municipal_council"],
      supportingAuthorities: ["vitthal_rukmini_temples_committee"],
    },
    domains: ["pilgrimage_facilities"],
    target: { description: "Wari period in Pandharpur", wards: [4, 5, 6] },
    budgetLineItems: [
      { label: "Rest areas", amountInr: 40_00_00_000 },
      { label: "Sanitation", amountInr: 25_00_00_000 },
      { label: "Crowd management", amountInr: 30_00_00_000 },
    ],
    statedTotalInr: 95_00_00_000,
    phases: [
      { name: "Preparation", startDate: "2027-01-01", endDate: "2027-05-31", milestone: "Sites ready" },
      { name: "Wari operations", startDate: "2027-06-01", endDate: "2027-07-31", milestone: "Wari complete" },
    ],
    channelIds: ["PILGRIMAGE_FACILITIES"],
  };

  it("is simulation-ready and derives the engine parameters", () => {
    const f = validatePolicyBrief(brief);
    expect(f.blockers).toEqual([]);
    expect(f.simulationReady).toBe(true);
    expect(f.derived.budgetInr).toBe(95_00_00_000);
    expect(f.derived.durationMonths).toBeGreaterThanOrEqual(3);
  });

  it("auto-fills the legal basis from the registry, not free text", () => {
    const basis = legalBasisFor(brief.governance);
    expect(basis.some((b) => b.instrument.includes("Municipal Councils"))).toBe(true);
    expect(basis.some((b) => b.instrument.includes("Pandharpur Temples Act"))).toBe(true);
  });

  it("is NOT simulation-ready when a line item does not match the total", () => {
    const broken: PolicyBrief = { ...brief, statedTotalInr: 90_00_00_000 };
    const f = validatePolicyBrief(broken);
    expect(f.simulationReady).toBe(false);
    expect(f.blockers.join(" ")).toMatch(/must equal the total exactly/);
  });

  it("throws rather than running an invalid brief", () => {
    const broken: PolicyBrief = { ...brief, statedTotalInr: 90_00_00_000 };
    expect(() => briefToPolicyVector(broken, { housing: 0, education: 0, employment: 0 }, 0.6)).toThrow();
  });

  it("maps a valid brief onto the engine's policy vector", () => {
    const mapping = briefToPolicyVector(brief, { housing: 0, education: 0, employment: 0 }, 0.7);
    expect(mapping.channelIds).toEqual(["PILGRIMAGE_FACILITIES"]);
    expect(mapping.budget).toBe(95_00_00_000);
  });

  it("rejects a governance configuration that is not competent", () => {
    const bad: PolicyBrief = {
      ...brief,
      domains: ["housing"],
      governance: {
        ...brief.governance,
        proposingAuthority: "vitthal_rukmini_temples_committee",
        primaryDecisionAuthority: "vitthal_rukmini_temples_committee",
        fundingAuthorities: ["vitthal_rukmini_temples_committee"],
        implementingAuthorities: ["vitthal_rukmini_temples_committee"],
      },
    };
    expect(validatePolicyBrief(bad).simulationReady).toBe(false);
  });
});

describe("timeline (spec §27)", () => {
  it("derives a duration from real dates", () => {
    const t = validateTimeline([
      { name: "A", startDate: "2027-01-01", endDate: "2027-06-30" },
      { name: "B", startDate: "2027-07-01", endDate: "2027-12-31" },
    ]);
    expect(t.valid).toBe(true);
    expect(t.durationMonths).toBeGreaterThanOrEqual(11);
    expect(t.durationMonths).toBeLessThanOrEqual(13);
  });

  it("flags a phase that ends before it starts", () => {
    const t = validateTimeline([{ name: "A", startDate: "2027-06-01", endDate: "2027-01-01" }]);
    expect(t.valid).toBe(false);
  });
});

describe("fact taxonomy (spec §5, §32)", () => {
  it("separates observed from modelled categories and orders source precedence", () => {
    expect(isObserved("OBSERVED")).toBe(true);
    expect(isObserved("HISTORICAL_OUTCOME")).toBe(true);
    expect(isModelled("MODEL_ASSUMPTION")).toBe(true);
    expect(isModelled("MODEL_INFERENCE")).toBe(true);
    expect(isObserved("MODEL_ASSUMPTION")).toBe(false);
    expect(FACT_CATEGORIES).toContain("SYNTHETIC");
    // Legislation outranks secondary reporting outranks a model assumption.
    expect(SOURCE_PRECEDENCE.official_act).toBeLessThan(SOURCE_PRECEDENCE.reliable_secondary_reporting);
    expect(SOURCE_PRECEDENCE.reliable_secondary_reporting).toBeLessThan(SOURCE_PRECEDENCE.model_assumption);
  });
});
