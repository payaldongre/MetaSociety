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
import { buildBn, compileBn, policyResponse } from "@/simulation/bn";
import { generatePopulation } from "@/simulation/population";
import { createRng } from "@/simulation/rng";
import { groundedPolicyBands, runSimulation } from "@/simulation/simulate";
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

/* ------------------------------------------------------------------ */
/* GGG grounding must REACH the network (no raw-policy bypass)         */
/* ------------------------------------------------------------------ */

describe("GGG grounding reaches the Bayesian network", () => {
  it("the grounded policy bands track the historical effect scale, monotonically", () => {
    // The seam through which GGG enters the network is `groundedPolicyBands`.
    // Before this fix the raw intensity/budget reached the network at full
    // strength; here a weakly comparable local application must read LOW and a
    // fully comparable one must read HIGH — i.e. the grounding changes the
    // scenario the network consumes rather than being decorative.
    const p = base({ intensity: 0.8, budget: 12e7, durationMonths: 12 });
    const weak = groundedPolicyBands(p, p.intensity, 0.1);
    const mid = groundedPolicyBands(p, p.intensity, 0.5);
    const strong = groundedPolicyBands(p, p.intensity, 1);

    expect(weak.intensityBand).toBe("low");
    expect(weak.budgetBand).toBe("low");
    expect(mid.intensityBand).toBe("medium");
    expect(strong.intensityBand).toBe("high");
    expect(strong.budgetBand).toBe("high");

    const rank = (b: string) => ["low", "medium", "high"].indexOf(b);
    expect(rank(weak.intensityBand)).toBeLessThan(rank(mid.intensityBand));
    expect(rank(mid.intensityBand)).toBeLessThan(rank(strong.intensityBand));
    expect(rank(weak.budgetBand)).toBeLessThan(rank(strong.budgetBand));
  });

  it("duration is a real policy input and is not grounded away", () => {
    expect(groundedPolicyBands(base({ durationMonths: 12 }), 0.5, 0.1).durationBand).toBe("short");
    expect(groundedPolicyBands(base({ durationMonths: 24 }), 0.5, 0.1).durationBand).toBe("medium");
    expect(groundedPolicyBands(base({ durationMonths: 60 }), 0.5, 0.1).durationBand).toBe("long");
  });

  it("the grounded band makes the network respond less than the raw band it replaced", () => {
    // This pins the ACTUAL causal consequence of the fix, at the network level
    // rather than at the helper's return value: the network's own
    // P(formal employment) response to the band GGG selects for a local policy
    // must be strictly smaller than its response to the raw intensity/budget
    // band. If GGG were being bypassed, the two would be identical.
    const pop = generatePopulation(20260101);
    const c = compileBn(buildBn(pop));

    const p = base({ channelIds: ["INCOME_SUPPORT"], intensity: 0.65, budget: 12e7, durationMonths: 12 });
    // effectScale = 1 reproduces the policy's RAW band, because the band is the
    // grounded value banded against fixed cut-offs.
    const raw = groundedPolicyBands(p, p.intensity, 1);
    const grounded = groundedPolicyBands(p, p.intensity, 0.1);

    // The grounding actually moves the policy into a lower band.
    expect(raw.intensityBand).toBe("medium");
    expect(grounded.intensityBand).toBe("low");
    expect(raw.budgetBand).toBe("high");
    expect(grounded.budgetBand).toBe("low");

    const sample = (bands: ReturnType<typeof groundedPolicyBands>) =>
      policyResponse(
        c,
        pop,
        { PolicyType: "labor", PolicyIntensity: bands.intensityBand, PolicyBudgetShare: bands.budgetBand },
        "EmploymentStatus",
        [2],
        3000,
        createRng(0x51af1e),
      );

    const rawP = sample(raw);
    const groundedP = sample(grounded);
    // The network reads the grounded (weaker) scenario, not the raw one.
    expect(groundedP).toBeLessThan(rawP);
    // And it is a materially smaller shift, not a rounding difference.
    expect(rawP - groundedP).toBeGreaterThan(0.005);
  }, 120_000);
});
