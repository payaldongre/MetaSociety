/**
 * Tests for the instrument parameter dictionary (Part A) and lineage grouping
 * (Part C). These are deliberately cheap: no full simulation run, just the data
 * and the pure helpers, so they add milliseconds to the suite.
 */

import { describe, expect, it } from "vitest";

import { decodeVector } from "@/simulation/simulate";
import {
  INSTRUMENTS,
  LIVE_INSTRUMENTS,
  allocationFor,
  instrumentFor,
  instrumentUsesAllocation,
} from "@/simulation/instruments";
import {
  bestInLineage,
  describeLineageKey,
  lineageHistory,
  lineageKeyFor,
  policyDistance,
} from "@/simulation/lineage";
import type { PolicyVector } from "@/simulation/types";
import { buildBn, compileBn, createRng, getPopulation, policyResponse } from "@/simulation";

describe("Part A — instrument parameter dictionary", () => {
  it("renders allocation only where it genuinely applies", () => {
    expect(instrumentUsesAllocation("subsidy")).toBe(true);
    expect(instrumentUsesAllocation("housing")).toBe(true);
    expect(instrumentUsesAllocation("education")).toBe(true);
    expect(instrumentUsesAllocation("labor")).toBe(true);
    // These instruments have no three-way split and must not show one.
    expect(instrumentUsesAllocation("tax")).toBe(false);
    expect(instrumentUsesAllocation("regulation")).toBe(false);
    expect(instrumentUsesAllocation("health")).toBe(false);
  });

  it("declares healthcare as a genuinely new category needing new nodes", () => {
    const health = instrumentFor("health");
    expect(health.newNodesRequired).toContain("HealthInsurance");
    expect(health.newNodesRequired).toContain("HealthBurden");
    // It must not silently reuse the subsidy's channels.
    expect(health.channels).not.toEqual(instrumentFor("subsidy").channels);
  });

  it("gives every live instrument a real parameter set and direct targets", () => {
    for (const instrument of LIVE_INSTRUMENTS) {
      expect(instrument.parameters.length).toBeGreaterThan(0);
      expect(instrument.parameters.some((p) => p.id === "intensity")).toBe(true);
      expect(instrument.directTargets.length).toBeGreaterThan(0);
    }
  });

  it("ignores the allocation genes for instruments that have no split", () => {
    const decoded = decodeVector([0.6, 5e6, 12, 0.9, 0.05, 0.05], "tax", "T");
    expect(decoded.allocation).toEqual(INSTRUMENTS.tax.defaultAllocation);

    const subsidy = decodeVector([0.6, 5e6, 12, 0.8, 0.1, 0.1], "subsidy", "S");
    expect(subsidy.allocation.housing).toBeCloseTo(0.8, 6);
    // allocationFor never returns a three-way split for tax.
    expect(allocationFor("tax", { housing: 1, education: 0, employment: 0 })).toEqual(
      INSTRUMENTS.tax.defaultAllocation,
    );
  });
});

describe("Part C — lineage grouping", () => {
  const subsidy: PolicyVector = {
    type: "subsidy",
    name: "S",
    intensity: 0.65,
    budget: 12e7,
    durationMonths: 24,
    allocation: { housing: 0.3, education: 0.4, employment: 0.3 },
  };

  it("isolates lineages by instrument — a health policy never joins a subsidy one", () => {
    const health: PolicyVector = { ...subsidy, type: "health" };
    const regulation: PolicyVector = { ...subsidy, type: "regulation" };
    expect(lineageKeyFor(health).startsWith("health|")).toBe(true);
    expect(lineageKeyFor(regulation).startsWith("regulation|")).toBe(true);
    expect(lineageKeyFor(health)).not.toBe(lineageKeyFor(subsidy));
    expect(policyDistance(health, subsidy)).toBe(1);
  });

  it("separates the same instrument by parameter band", () => {
    const low = { ...subsidy, intensity: 0.2 };
    const high = { ...subsidy, intensity: 0.9 };
    expect(lineageKeyFor(low)).not.toBe(lineageKeyFor(high));
  });

  it("returns only a lineage's own history, best-first", () => {
    const key = lineageKeyFor(subsidy);
    const other: PolicyVector = { ...subsidy, type: "tax" };
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
    expect(described.instrument).toBe("subsidy");
    expect(described.bands).toContain("intensity");
  });
});

describe("healthcare is a dedicated channel, not a subsidy alias", () => {
  const pop = getPopulation();
  const c = compileBn(buildBn(pop));
  const n = 400;
  const strong = (type: PolicyVector["type"]) => ({
    PolicyType: type,
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
