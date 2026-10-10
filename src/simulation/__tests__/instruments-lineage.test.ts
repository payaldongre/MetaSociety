/**
 * Tests for the channel dictionary (Part A) and lineage grouping (Part C).
 * These are deliberately cheap: no full simulation run, just the data and the
 * pure helpers, so they add milliseconds to the suite.
 */

import { describe, expect, it } from "vitest";

import { decodeVector } from "@/simulation/simulate";
import {
  CHANNELS,
  DECLARED_CHANNELS,
  IMPLEMENTED_CHANNELS,
  allocationFor,
  appliedChannelDisclosure,
  bestInLineage,
  buildBn,
  channelsUseAllocation,
  compileBn,
  createRng,
  describeLineageKey,
  engineInstrumentFor,
  getPopulation,
  lineageHistory,
  lineageKeyFor,
  pendingChannelNodes,
  policyDistance,
  policyResponse,
  suggestChannels,
} from "@/simulation";
import type { PolicyVector } from "@/simulation/types";

describe("Part A — channel dictionary", () => {
  it("maps every implemented channel onto a real engine family", () => {
    expect(engineInstrumentFor(["INCOME_SUPPORT"])).toBe("subsidy");
    expect(engineInstrumentFor(["TAX_FISCAL"])).toBe("tax");
    expect(engineInstrumentFor(["HOUSING"])).toBe("housing");
    expect(engineInstrumentFor(["EDUCATION_SKILL"])).toBe("education");
    expect(engineInstrumentFor(["LABOR_MARKET"])).toBe("labor");
    expect(engineInstrumentFor(["REGULATION"])).toBe("regulation");
    expect(engineInstrumentFor(["HEALTHCARE_ACCESS"])).toBe("health");
  });

  it("leaves declared channels unwired — never a silent fallback", () => {
    for (const channel of DECLARED_CHANNELS) {
      expect(engineInstrumentFor([channel.id])).toBe("none");
      expect(pendingChannelNodes([channel.id]).length).toBeGreaterThan(0);
    }
    // A policy that mixes a declared channel with an implemented one still runs
    // the implemented one — but the declared one is surfaced as pending.
    expect(engineInstrumentFor(["INFRASTRUCTURE", "HOUSING"])).toBe("housing");
    expect(pendingChannelNodes(["INFRASTRUCTURE", "HOUSING"])).toEqual([
      { channelId: "INFRASTRUCTURE", missingNodes: ["InfraAccess"] },
    ]);
  });

  it("selects the engine family independently of channel order", () => {
    // The concrete defect: reordering a multi-channel policy must not change the
    // simulation. The applied family is chosen by a fixed precedence.
    expect(engineInstrumentFor(["LABOR_MARKET", "EDUCATION_SKILL"])).toBe("labor");
    expect(engineInstrumentFor(["EDUCATION_SKILL", "LABOR_MARKET"])).toBe("labor");
    // Order-invariance must hold for EVERY pair of implemented channels.
    const ids = IMPLEMENTED_CHANNELS.map((c) => c.id);
    for (const a of ids) {
      for (const b of ids) {
        expect(engineInstrumentFor([a, b])).toBe(engineInstrumentFor([b, a]));
      }
    }
  });

  it("discloses that a multi-channel policy applies only one family", () => {
    expect(appliedChannelDisclosure(["LABOR_MARKET"])).toBeNull();
    const d = appliedChannelDisclosure(["EDUCATION_SKILL", "LABOR_MARKET"]);
    expect(d).not.toBeNull();
    // Order-invariant: the applied family is the same whichever way it is listed.
    expect(d).toEqual(appliedChannelDisclosure(["LABOR_MARKET", "EDUCATION_SKILL"]));
    expect(d!.applied).toBe("labor");
    expect(d!.unapplied).toContain("education");
  });

  it("renders allocation only where channels genuinely use it", () => {
    expect(channelsUseAllocation(["INCOME_SUPPORT"])).toBe(true);
    expect(channelsUseAllocation(["HOUSING"])).toBe(true);
    expect(channelsUseAllocation(["EDUCATION_SKILL"])).toBe(true);
    expect(channelsUseAllocation(["LABOR_MARKET"])).toBe(true);
    // These channels have no three-way split and must not show one.
    expect(channelsUseAllocation(["TAX_FISCAL"])).toBe(false);
    expect(channelsUseAllocation(["REGULATION"])).toBe(false);
    expect(channelsUseAllocation(["HEALTHCARE_ACCESS"])).toBe(false);
    expect(channelsUseAllocation([])).toBe(false);
  });

  it("gives every channel a real parameter set and direct targets", () => {
    for (const channel of [...IMPLEMENTED_CHANNELS, ...DECLARED_CHANNELS]) {
      expect(channel.parameters.length).toBeGreaterThan(0);
      expect(channel.parameters.some((p) => p.key === "intensity")).toBe(true);
      expect(channel.directTargets.length).toBeGreaterThan(0);
    }
  });

  it("includes the two added channels, declared with their pending nodes", () => {
    expect(CHANNELS.INFRASTRUCTURE.status).toBe("declared");
    expect(CHANNELS.INFRASTRUCTURE.bnNodesPending).toContain("InfraAccess");
    expect(CHANNELS.FINANCIAL_INCLUSION.status).toBe("declared");
    expect(CHANNELS.FINANCIAL_INCLUSION.bnNodesPending).toContain("CreditAccess");
  });

  it("ignores the allocation genes for channels that have no split", () => {
    const decoded = decodeVector([0.6, 5e6, 12, 0.9, 0.05, 0.05], ["TAX_FISCAL"], "T");
    expect(decoded.allocation).toEqual({ housing: 0, education: 0, employment: 0 });

    const subsidy = decodeVector([0.6, 5e6, 12, 0.8, 0.1, 0.1], ["INCOME_SUPPORT"], "S");
    expect(subsidy.allocation.housing).toBeCloseTo(0.8, 6);
    // allocationFor never returns a three-way split for a tax channel.
    expect(allocationFor(["TAX_FISCAL"], { housing: 1, education: 0, employment: 0 })).toEqual({
      housing: 0,
      education: 0,
      employment: 0,
    });
  });

  it("suggests channels contextually and reports a clean zero-match", () => {
    // "healthcare", "medical" and "hospital access" all surface the same channel
    // without an exact keyword hit each.
    expect(suggestChannels("healthcare for rural families")).toContain("HEALTHCARE_ACCESS");
    expect(suggestChannels("medical cover expansion")).toContain("HEALTHCARE_ACCESS");
    expect(suggestChannels("hospital access programme")).toContain("HEALTHCARE_ACCESS");
    expect(suggestChannels("road and water infrastructure")).toContain("INFRASTRUCTURE");
    // The real generalisation test: a policy name that matches NOTHING must
    // return an empty set, so the UI can say so plainly rather than fall back.
    expect(suggestChannels("free laptops for students")).toEqual([]);
  });
});

describe("Part C — lineage grouping", () => {
  const subsidy: PolicyVector = {
    channelIds: ["INCOME_SUPPORT"],
    name: "S",
    intensity: 0.65,
    budget: 12e7,
    durationMonths: 24,
    allocation: { housing: 0.3, education: 0.4, employment: 0.3 },
  };

  it("isolates lineages by channel set — a health policy never joins a subsidy one", () => {
    const health: PolicyVector = { ...subsidy, channelIds: ["HEALTHCARE_ACCESS"] };
    const regulation: PolicyVector = { ...subsidy, channelIds: ["REGULATION"] };
    expect(lineageKeyFor(health).startsWith("HEALTHCARE_ACCESS|")).toBe(true);
    expect(lineageKeyFor(regulation).startsWith("REGULATION|")).toBe(true);
    expect(lineageKeyFor(health)).not.toBe(lineageKeyFor(subsidy));
    expect(policyDistance(health, subsidy)).toBe(1);
  });

  it("treats a multi-channel set as its own lineage, independent of order", () => {
    const a: PolicyVector = { ...subsidy, channelIds: ["HOUSING", "INCOME_SUPPORT"] };
    const b: PolicyVector = { ...subsidy, channelIds: ["INCOME_SUPPORT", "HOUSING"] };
    expect(lineageKeyFor(a)).toBe(lineageKeyFor(b));
    expect(lineageKeyFor(a)).not.toBe(lineageKeyFor(subsidy));
  });

  it("separates the same channel set by parameter band", () => {
    const low = { ...subsidy, intensity: 0.2 };
    const high = { ...subsidy, intensity: 0.9 };
    expect(lineageKeyFor(low)).not.toBe(lineageKeyFor(high));
  });

  it("returns only a lineage's own history, best-first", () => {
    const key = lineageKeyFor(subsidy);
    const other: PolicyVector = { ...subsidy, channelIds: ["TAX_FISCAL"] };
    const records = [
      { lineageKey: key, policy: subsidy, effectivenessScore: 55 },
      { lineageKey: key, policy: subsidy, effectivenessScore: 72 },
      { lineageKey: lineageKeyFor(other), policy: other, effectivenessScore: 99 },
    ];
    const history = lineageHistory(records, key);
    expect(history).toHaveLength(2);
    expect(history[0].effectivenessScore).toBe(72);
    expect(bestInLineage(records, key)?.effectivenessScore).toBe(72);
    // The other lineage's 99 must never leak into this lineage.
    expect(history.some((r) => r.effectivenessScore === 99)).toBe(false);
  });

  it("describes a lineage key without throwing", () => {
    const described = describeLineageKey(lineageKeyFor(subsidy));
    expect(described.channels).toBe("INCOME_SUPPORT");
    expect(described.bands).toContain("intensity");
  });
});

describe("healthcare is a dedicated channel, not a subsidy alias", () => {
  const pop = getPopulation();
  const c = compileBn(buildBn(pop));
  const n = 400;
  // The BN node is still named PolicyType; its domain is the internal engine
  // family vocabulary, which a channel set maps onto (see instruments.ts).
  const strong = (family: string) => ({
    PolicyType: family,
    PolicyIntensity: "high",
    PolicyBudgetShare: "high",
  });

  it("does not scale the generic subsidy sector-demand response", () => {
    const rng = createRng(13579);
    const none = policyResponse(c, pop, { PolicyType: "none" }, "SectorDemand", [2], n, rng);
    const subsidy = policyResponse(c, pop, strong("subsidy"), "SectorDemand", [2], n, rng);
    const health = policyResponse(c, pop, strong("health"), "SectorDemand", [2], n, rng);
    expect(subsidy).toBeGreaterThan(none);
    // The previous bug: a healthcare-labelled run produced a pure intensity-
    // scaled subsidy response. Health must NOT drive sector demand that way.
    expect(health).toBeLessThan(subsidy);
  });

  it("moves its own node (coverage) under a health policy", () => {
    const rng = createRng(24680);
    const none = policyResponse(c, pop, { PolicyType: "none" }, "HealthInsurance", [1], n, rng);
    const health = policyResponse(c, pop, strong("health"), "HealthInsurance", [1], n, rng);
    expect(health).toBeGreaterThan(none);
  });
});
