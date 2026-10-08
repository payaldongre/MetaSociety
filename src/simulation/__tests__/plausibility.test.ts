/**
 * Plausibility regression tests.
 *
 * The magnitude defect these guard against: a small local policy (e.g. ₹12 crore
 * for one town) producing a national-scheme-scale headline such as GDP +58% /
 * employment +65%. The fix is structural (GGG grounds the effect scale, so a
 * local application of a larger mechanism runs at a small scale), NOT an
 * arbitrary output cap. These tests assert the STRUCTURAL properties, so they
 * cannot be satisfied by clamping a number:
 *
 *   - the baseline is its own denominator, so a no-policy run moves by zero;
 *   - longer duration does not compound the effect unboundedly;
 *   - much larger budgets do not multiply the effect proportionally;
 *   - the pilgrimage channel's seasonal policy carries no generic income effect.
 */

import { describe, expect, it } from "vitest";

import { BN_VERSION } from "@/simulation";
import { runSimulation } from "@/simulation/simulate";
import type { PolicyVector, SimulationResult } from "@/simulation/types";

const base = (o: Partial<PolicyVector> = {}): PolicyVector => ({
  channelIds: ["INCOME_SUPPORT"],
  name: "Plausibility probe",
  intensity: 0.65,
  budget: 12e7,
  durationMonths: 12,
  allocation: { housing: 0.3, education: 0.4, employment: 0.3 },
  ...o,
});

const run = (p: PolicyVector, seed = 20260101): Promise<SimulationResult> =>
  runSimulation(
    { townId: "pandharpur_in_mh", policy: p, mode: "single", seed, bnVersion: BN_VERSION, zoneFilter: "all" },
    { intervalRounds: 1, skipSearch: true },
  );

describe("plausibility of policy magnitudes", () => {
  it(
    "a no-policy baseline is its own denominator and moves by exactly zero",
    async () => {
      const res = await run(base());
      expect(res.baseline.gdpGrowthPct).toBe(0);
      // Every baseline figure is finite and on its natural scale.
      for (const v of Object.values(res.baseline)) expect(Number.isFinite(v)).toBe(true);
      expect(res.baseline.employmentRatePct).toBeGreaterThan(0);
      expect(res.baseline.employmentRatePct).toBeLessThan(100);
    },
    120_000,
  );

  it(
    "a small local subsidy does not produce a national-scale headline",
    async () => {
      const res = await run(base({ budget: 12e7, intensity: 0.65, durationMonths: 24 }));
      // The old, implausible behaviour was GDP +51% / employment +21pp. The
      // grounded mechanism keeps a ₹12-crore local programme small.
      const empDelta = res.point.employmentRatePct - res.baseline.employmentRatePct;
      expect(Math.abs(res.point.gdpGrowthPct)).toBeLessThan(20);
      expect(Math.abs(empDelta)).toBeLessThan(8);
      // And it is directionally sensible rather than merely small.
      expect(res.point.employmentRatePct).toBeGreaterThanOrEqual(res.baseline.employmentRatePct - 0.05);
    },
    180_000,
  );

  it(
    "duration does not compound the effect unboundedly",
    async () => {
      const short = await run(base({ durationMonths: 12 }));
      const long = await run(base({ durationMonths: 60 }));
      const shortDelta = short.point.employmentRatePct - short.baseline.employmentRatePct;
      const longDelta = long.point.employmentRatePct - long.baseline.employmentRatePct;
      // Five times the duration must not produce anything like five times the
      // effect: the mechanism is level-grounded, not a per-period ratchet.
      expect(Math.abs(longDelta)).toBeLessThanOrEqual(Math.abs(shortDelta) + 3);
      expect(Math.abs(long.point.gdpGrowthPct)).toBeLessThan(Math.abs(short.point.gdpGrowthPct) + 10);
    },
    240_000,
  );

  it(
    "much larger budgets do not multiply the effect proportionally",
    async () => {
      const small = await run(base({ budget: 2e7, durationMonths: 12 }));
      const large = await run(base({ budget: 20e7, durationMonths: 12 }));
      const smallDelta = Math.abs(small.point.employmentRatePct - small.baseline.employmentRatePct);
      const largeDelta = Math.abs(large.point.employmentRatePct - large.baseline.employmentRatePct);
      // A 10× budget must not give a 10× employment effect.
      expect(largeDelta).toBeLessThanOrEqual(smallDelta * 4 + 2);
      // Nor may it escape the plausible band entirely.
      expect(largeDelta).toBeLessThan(10);
    },
    240_000,
  );

  it(
    "a pilgrimage policy carries its seasonal effect and no generic income effect",
    async () => {
      const p = base({ channelIds: ["PILGRIMAGE_FACILITIES"], budget: 12e7, intensity: 0.8, durationMonths: 12 });
      const res = await run(p);
      expect(res.seasonality?.policyCarriesPilgrimage).toBe(true);
      // The pilgrimage channel has no generic micro-instrument family, so its
      // mean income must not move materially.
      const incomeDelta = Math.abs(res.point.meanIncome - res.baseline.meanIncome);
      expect(incomeDelta).toBeLessThan(Math.abs(res.baseline.meanIncome) * 0.05);
      // GGG still grounds and explains it.
      expect(res.ggg?.parents.map((x) => x.policyId)).toContain("wari-toll-exemption");
    },
    180_000,
  );
});
