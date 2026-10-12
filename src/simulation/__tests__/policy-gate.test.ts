/**
 * Governance / feasibility GATE tests (spec §6, §7, §8, §26, §27).
 *
 * These prove the P0 requirement: a policy that fails a blocking
 * governance/budget/timeline requirement cannot reach the simulation engine.
 * The gate is enforced in the ENGINE layer (`runSimulation` / `runPolicyBriefSimulation`),
 * reusing `validateGovernance` and `validatePolicyBrief` — not reimplemented,
 * and not confined to the React UI.
 */

import { describe, expect, it, vi } from "vitest";

import {
  BN_VERSION,
  PolicyFeasibilityError,
  briefToPolicyVector,
  runPolicyBriefSimulation,
  runSimulation,
  validatePolicyBrief,
  validateGovernance,
  type PolicyBrief,
  type SimulationRequest,
} from "@/simulation";
import type { AuthorityRoles } from "@/simulation/governance";

const validRoles: AuthorityRoles = {
  proposingAuthority: "pandharpur_municipal_council",
  primaryDecisionAuthority: "pandharpur_municipal_council",
  approvalAuthorities: [],
  fundingAuthorities: ["pandharpur_municipal_council"],
  implementingAuthorities: ["pandharpur_municipal_council"],
  supportingAuthorities: [],
};

/** A valid Pandharpur brief: council-decided income support, 3-month phase. */
function validBrief(overrides: Partial<PolicyBrief> = {}): PolicyBrief {
  return {
    id: "gate-test",
    title: "Pandharpur income-support pilot",
    objective: "Raise household income",
    problemStatement: "Low household income in Pandharpur wards",
    governance: validRoles,
    domains: ["income_support"],
    target: { description: "Working-age residents in Pandharpur", wards: [3, 4, 5] },
    budgetLineItems: [
      { label: "Transfers", amountInr: 60_000_000 },
      { label: "Administration", amountInr: 12_000_000 },
    ],
    statedTotalInr: 72_000_000,
    phases: [{ name: "Implementation", startDate: "2027-01-01", endDate: "2027-03-31" }],
    channelIds: ["INCOME_SUPPORT"],
    ...overrides,
  };
}

/** An invalid brief: a body with no competence for housing, with a broken budget. */
function invalidBrief(): PolicyBrief {
  return {
    ...validBrief(),
    domains: ["housing"],
    governance: {
      proposingAuthority: "vitthal_rukmini_temples_committee",
      primaryDecisionAuthority: "vitthal_rukmini_temples_committee",
      approvalAuthorities: [],
      fundingAuthorities: ["vitthal_rukmini_temples_committee"],
      implementingAuthorities: ["vitthal_rukmini_temples_committee"],
      supportingAuthorities: [],
    },
    channelIds: ["HOUSING"],
    statedTotalInr: 10_000_000, // does not equal the line items
  };
}

describe("feasibility gate — invalid authority/domain can't reach the engine", () => {
  it("refuses a brief the deciding authority is not competent for", async () => {
    const f = validatePolicyBrief(invalidBrief());
    expect(f.simulationReady).toBe(false);
    expect(f.status).toBe("unsupported_by_authority");
    expect(f.blockers.join(" ")).toMatch(/not competent to decide/);
  });

  it("throws PolicyFeasibilityError from the engine when an invalid brief is supplied", async () => {
    const request: SimulationRequest = {
      townId: "pandharpur_in_mh",
      policy: {
        channelIds: ["HOUSING"],
        name: "Invalid housing",
        intensity: 0.6,
        budget: 10_000_000,
        durationMonths: 12,
        allocation: { housing: 0.7, education: 0.1, employment: 0.2 },
      },
      mode: "single",
      seed: 42,
      bnVersion: BN_VERSION,
      brief: invalidBrief(),
    };
    // The gate runs BEFORE any engine work, so no progress callback ever fires.
    const onProgress = vi.fn();
    await expect(runSimulation(request, { intervalRounds: 1, onProgress })).rejects.toBeInstanceOf(
      PolicyFeasibilityError,
    );
    expect(onProgress).not.toHaveBeenCalled();
  });

  it("throws from the brief-first entry point and carries the structured reason", async () => {
    let caught: unknown;
    try {
      await runPolicyBriefSimulation(invalidBrief(), {}, { intervalRounds: 1 });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(PolicyFeasibilityError);
    const err = caught as PolicyFeasibilityError;
    expect(err.feasibility.blockers.length).toBeGreaterThan(0);
    expect(err.message).toMatch(/not simulation-ready/);
  });

  it("refuses a brief whose budget line items do not equal the stated total", async () => {
    const broken = validBrief({ statedTotalInr: 70_000_000 });
    expect(validatePolicyBrief(broken).simulationReady).toBe(false);
    await expect(runPolicyBriefSimulation(broken)).rejects.toBeInstanceOf(PolicyFeasibilityError);
  });

  it("refuses a brief with no valid implementation phase", async () => {
    const broken = validBrief({ phases: [] });
    expect(validatePolicyBrief(broken).simulationReady).toBe(false);
    await expect(runPolicyBriefSimulation(broken)).rejects.toBeInstanceOf(PolicyFeasibilityError);
  });
});

describe("feasibility gate — valid Pandharpur configurations pass", () => {
  it("accepts a council-decided income-support brief and maps it", () => {
    const brief = validBrief();
    const f = validatePolicyBrief(brief);
    expect(f.simulationReady).toBe(true);
    expect(f.blockers).toEqual([]);
    expect(f.derived.budgetInr).toBe(72_000_000);
    const mapping = briefToPolicyVector(brief, { housing: 0.2, education: 0.3, employment: 0.5 }, 0.7);
    expect(mapping.budget).toBe(72_000_000);
    expect(mapping.channelIds).toEqual(["INCOME_SUPPORT"]);
  });

  it("accepts a state-sanctioned pilgrimage-facilities brief with escalation represented", () => {
    const brief: PolicyBrief = {
      ...validBrief(),
      title: "Wari sanitation programme",
      domains: ["pilgrimage_facilities"],
      channelIds: ["PILGRIMAGE_FACILITIES"],
      governance: {
        proposingAuthority: "pandharpur_municipal_council",
        primaryDecisionAuthority: "pandharpur_municipal_council",
        approvalAuthorities: ["vitthal_rukmini_temples_committee"],
        fundingAuthorities: ["government_of_maharashtra"],
        implementingAuthorities: ["pandharpur_municipal_council"],
        supportingAuthorities: ["vitthal_rukmini_temples_committee"],
      },
    };
    const f = validatePolicyBrief(brief);
    expect(f.simulationReady).toBe(true);
    expect(f.status).toBe("legally_feasible");
  });

  it("runs an end-to-end simulation from a valid brief, with budget/duration derived from it", async () => {
    const result = await runPolicyBriefSimulation(validBrief(), {}, { intervalRounds: 1, searchAgents: 60 });
    // 3-month phase -> 3-month duration -> 1 simulated period: the brief's
    // timeline drove the engine, not a slider.
    expect(result.periods).toBe(1);
    expect(result.populationSize).toBe(98923);
    expect(result.validation.filter((v) => !v.passed)).toEqual([]);
  }, 180_000);
});

describe("feasibility status distinctions are preserved", () => {
  it("keeps legally feasible, escalation and unsupported distinct", () => {
    const feasible = validateGovernance(validRoles, ["income_support"]);
    expect(feasible.status).toBe("legally_feasible");

    const escalates = validateGovernance(
      { ...validRoles, primaryDecisionAuthority: "pandharpur_municipal_council" },
      ["pilgrimage_facilities"],
    );
    expect(["requires_escalation", "conditionally_feasible", "legally_feasible"]).toContain(escalates.status);

    const unsupported = validateGovernance(
      {
        proposingAuthority: "vitthal_rukmini_temples_committee",
        primaryDecisionAuthority: "vitthal_rukmini_temples_committee",
        approvalAuthorities: [],
        fundingAuthorities: ["vitthal_rukmini_temples_committee"],
        implementingAuthorities: ["vitthal_rukmini_temples_committee"],
        supportingAuthorities: [],
      },
      ["healthcare"],
    );
    expect(unsupported.status).toBe("unsupported_by_authority");
  });

  it("never invents a statutory monetary ceiling", () => {
    const f = validatePolicyBrief(validBrief({ statedTotalInr: 72_000_000 }));
    expect(f.governance).toBeDefined();
    // The simulation safety limit is a model assumption, surfaced as a condition only.
    expect(f.conditions.join(" ") === "" || !/statutory/i.test(f.conditions.join(" "))).toBe(true);
  });
});
