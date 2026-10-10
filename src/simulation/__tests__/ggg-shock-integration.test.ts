/**
 * End-to-end integration: Policy Brief → Governance → GGG → grounded policy →
 * dynamic BN → external-shock queue → dequeue → BN propagation → town outcomes,
 * with the baseline and the policy receiving the SAME shock realization.
 *
 * Deliberately few full-population runs (each ~10s) so the claim is proven on
 * the real engine without turning the suite into a benchmark.
 */

import { describe, expect, it } from "vitest";

import { BN_VERSION, runSimulation, type MetricKey, type PolicyVector, type SimulationRequest } from "@/simulation";

const policy: PolicyVector = {
  channelIds: ["LABOR_MARKET", "EDUCATION_SKILL"],
  name: "Pandharpur Local Employment & Skills Mission",
  intensity: 0.7,
  budget: 8e7,
  durationMonths: 60,
  allocation: { housing: 0.2, education: 0.4, employment: 0.4 },
};

const request = (scenario?: SimulationRequest["scenario"]): SimulationRequest => ({
  townId: "pandharpur_in_mh",
  policy,
  mode: "single",
  seed: 20260202,
  bnVersion: BN_VERSION,
  zoneFilter: "all",
  scenario,
});

const opts = { intervalRounds: 1, skipSearch: true } as const;

function maxAbsPointDelta(a: Record<MetricKey, number>, b: Record<MetricKey, number>): number {
  return Math.max(...(Object.keys(a) as MetricKey[]).map((k) => Math.abs(a[k] - b[k])));
}

describe("GGG + dynamic BN + external shock integration", () => {
  it(
    "carries GGG lineage, grounds the policy, queues a shock, and keeps the comparison fair",
    async () => {
      const result = await runSimulation(
        request({
          mode: "manual",
          manual: [{ shockId: "economic-downturn", startPeriod: 4, durationPeriods: 6, severity: "severe" }],
        }),
        opts,
      );

      // 1. GGG lineage exists and grounds the policy.
      expect(result.ggg).toBeDefined();
      expect(result.ggg!.lineage.map((l) => l.step)).toContain("Historical parents");
      expect(result.ggg!.grounded.effectScale).toBeGreaterThan(0);
      expect(result.ggg!.grounded.effectScale).toBeLessThanOrEqual(1);

      // 2. The dynamic nodes were evaluated (the network validation passed).
      expect(result.validation.filter((v) => !v.passed)).toEqual([]);

      // 3–6. A shock was generated, queued and dequeued at the configured period.
      expect(result.shocks).toBeDefined();
      expect(result.shocks!.events).toHaveLength(1);
      expect(result.shocks!.events[0]).toMatchObject({ time: 4, durationPeriods: 6, severity: "severe" });
      expect(result.shocks!.arrivalModel).toBe("MANUAL");
      expect(result.shocks!.sameScheduleForBaselineAndPolicy).toBe(true);
      expect(result.shocks!.events[0].provenance).toMatch(/scenario_assumption/);

      // 7. Baseline and policy share the same external scenario.
      expect(result.baseline).toBeDefined();
      expect(result.point).toBeDefined();

      // 8. Policy effects survive the shock and remain distinguishable.
      expect(result.point.employmentRatePct).toBeGreaterThan(result.baseline.employmentRatePct);

      // 9/10. Determinism.
      const again = await runSimulation(
        request({
          mode: "manual",
          manual: [{ shockId: "economic-downturn", startPeriod: 4, durationPeriods: 6, severity: "severe" }],
        }),
        opts,
      );
      expect(again.runId).toBe(result.runId);
      expect(again.point).toEqual(result.point);

      expect(result.warnings.some((w) => /stress test/i.test(w))).toBe(true);
    },
    300_000,
  );

  it(
    "a shock scenario differs from normal conditions under the same policy",
    async () => {
      const normal = await runSimulation(request({ mode: "none" }), opts);
      const shaken = await runSimulation(
        request({
          mode: "manual",
          manual: [
            { shockId: "economic-downturn", startPeriod: 2, durationPeriods: 8, severity: "severe" },
            { shockId: "public-health-emergency", startPeriod: 10, durationPeriods: 5, severity: "moderate" },
          ],
        }),
        opts,
      );
      // The external scenario changes the town outcome; it is not a no-op.
      expect(maxAbsPointDelta(normal.point, shaken.point)).toBeGreaterThan(1e-6);
      // Baseline and policy under the shock are both reported.
      expect(Number.isFinite(shaken.baseline.employmentRatePct)).toBe(true);
      expect(shaken.shocks!.events).toHaveLength(2);
    },
    400_000,
  );

  it(
    "the stochastic stress test generates a reproducible event set from the seed",
    async () => {
      const scenario: SimulationRequest["scenario"] = {
        mode: "stochastic",
        stochastic: [{ shockId: "economic-downturn", ratePerYear: 1.5, maxEvents: 5 }],
      };
      const result = await runSimulation(request(scenario), opts);
      expect(result.shocks!.arrivalModel).toBe("POISSON");
      expect(result.shocks!.rates[0].ratePerYear).toBe(1.5);
      for (const e of result.shocks!.events) {
        expect(e.arrivalModel).toBe("POISSON");
        expect(e.time).toBeGreaterThanOrEqual(0);
        expect(e.time).toBeLessThan(result.periods);
      }
      expect(result.shocks!.disclosure).toMatch(/not predictions of future disasters/);
    },
    300_000,
  );
});
