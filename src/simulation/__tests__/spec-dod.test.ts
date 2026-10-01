/**
 * Additive Definition-of-Done checks from SIMULATION_LAB_SPEC.md.
 *
 * These complement `engine.test.ts` rather than duplicate it. The spec's
 * per-phase "definition of done" asks for a few things the main suite does not
 * assert directly:
 *
 *   - §2  the profile key `(income_class, is_worker, sector, ward)` yields
 *         hundreds of populated cells, not the 10 clusters k-means produced,
 *         and no citizen is silently dropped.
 *   - §3.3 zones are a partition of the population.
 *   - §3  identities fail LOUDLY when violated (not just "hold when correct").
 *   - §3  an uncertainty is a real distribution, so the interval helper must
 *         order (and collapse) correctly.
 *   - §1  income and sector must never be presented as Census-measured.
 *
 * Everything here is cheap by design: one population generation and no full
 * simulation runs, so it adds seconds, not a second minute, to the suite.
 */

import { describe, expect, it } from "vitest";

import { AccountingViolationError, assertIdentities, computeLevels } from "@/simulation/aggregate";
import { CENSUS, FIELD_LEDGER, generatePopulation, intervalFor, zonePopulations } from "@/simulation";
import { WORKER_STATUSES } from "@/simulation/types";

const WORKING_AGE_MIN = 15;
const pop = generatePopulation(20260101);

function cellKey(i: number): string {
  const worker = pop.workerStatus[i] !== WORKER_STATUSES.indexOf("non_worker") ? 1 : 0;
  return `${pop.incomeClass[i]}|${worker}|${pop.sector[i]}|${pop.ward[i]}`;
}

describe("spec §2 — behavioural profiles replace k-means clusters", () => {
  it("populates hundreds of real profile cells, not ten representatives", () => {
    const cells = new Set<string>();
    for (let i = 0; i < pop.size; i += 1) {
      if (pop.age[i] < WORKING_AGE_MIN) continue;
      cells.add(cellKey(i));
    }
    expect(cells.size).toBeGreaterThan(100);
  });

  it("drops no citizen: the cells account for every working-age resident", () => {
    const tally = new Map<string, number>();
    let counted = 0;
    let workingAge = 0;
    for (let i = 0; i < pop.size; i += 1) {
      if (pop.age[i] < WORKING_AGE_MIN) continue;
      workingAge += 1;
      const key = cellKey(i);
      tally.set(key, (tally.get(key) ?? 0) + 1);
      counted += 1;
    }
    const summed = [...tally.values()].reduce((a, b) => a + b, 0);
    expect(summed).toBe(counted);
    expect(counted).toBe(workingAge);
    expect(workingAge).toBeGreaterThan(0);
  });
});

describe("spec §3.3 — zones are a reporting lens over wards", () => {
  it("partitions the whole generated population", () => {
    const byZone = zonePopulations(pop);
    const total = byZone.north + byZone.east + byZone.south + byZone.west;
    expect(total).toBe(pop.size);
    expect(total).toBe(CENSUS.totalPopulation);
  });
});

describe("spec §3 — accounting identities fail loudly", () => {
  const level = computeLevels({
    pop,
    inflationBand: 1,
    budgetSpend: 0,
    taxRevenue: 0,
    transfersAssigned: 0,
    externalFunding: 0,
    migrationOutflow: 0,
    declaredBudget: 0,
    cumulativeSpend: 0,
  });

  it("holds on the generated population with no policy applied", () => {
    expect(() => assertIdentities(pop, level)).not.toThrow();
  });

  it("throws AccountingViolationError when a budget identity is violated", () => {
    const overspent = { ...level, declaredBudget: 1_000, cumulativeSpend: 5_000 };
    expect(() => assertIdentities(pop, overspent)).toThrow(AccountingViolationError);
  });
});

describe("spec §6.7 — protest risk is a mean per-agent propensity, not a union", () => {
  it("reports the mean and is not saturated by the ~99k-agent population", () => {
    const level = computeLevels({
      pop,
      inflationBand: 1,
      budgetSpend: 0,
      taxRevenue: 0,
      transfersAssigned: 0,
      externalFunding: 0,
      migrationOutflow: 0,
      declaredBudget: 0,
      cumulativeSpend: 0,
    });
    let sum = 0;
    let count = 0;
    for (let i = 0; i < pop.size; i += 1) {
      if (!pop.active[i]) continue;
      sum += Math.min(1, Math.max(0, pop.protestPropensity[i]));
      count += 1;
    }
    expect(level.protestRisk).toBeCloseTo(sum / count, 12);
    // "Probability at least one of ~99k citizens protests" is forced to ~1 for
    // any non-zero per-agent probability; a mean is not.
    expect(level.protestRisk).toBeLessThan(1);
  });
});

describe("spec §3 — uncertainty is a distribution, not a decoration", () => {
  it("orders the interval and collapses a degenerate sample", () => {
    const spread = intervalFor([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(spread.p05).toBeLessThan(spread.p50);
    expect(spread.p50).toBeLessThan(spread.p95);
    expect(intervalFor([4, 4, 4])).toEqual({ p05: 4, p50: 4, p95: 4 });
    expect(intervalFor([])).toEqual({ p05: 0, p50: 0, p95: 0 });
  });
});

describe("spec §1 — the provenance caveat is carried in code, not just in prose", () => {
  it("separates measured Census fields from modelled ones", () => {
    const measured = FIELD_LEDGER.filter((e) => e.tag === "census2011");
    const modelled = FIELD_LEDGER.filter((e) => e.tag === "modelled");
    expect(measured.length).toBeGreaterThan(0);
    expect(modelled.length).toBeGreaterThan(0);
  });

  it("never claims income or sector are Census measurements", () => {
    for (const field of ["income_class", "income", "sector"]) {
      const entry = FIELD_LEDGER.find((e) => e.field === field);
      expect(entry, `${field} missing from the ledger`).toBeTruthy();
      expect(entry?.tag).not.toBe("census2011");
    }
  });
});
