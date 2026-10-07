/**
 * Impact-language tests (redesign spec §19, §20, §22, §28, §29).
 * Pure: uses a hand-built SimulationResult-shaped fixture, no engine roll.
 */

import { describe, expect, it } from "vitest";

import { assessMetric, impactStatement, magnitudeCalibrationFor, reproducibilityInfo, uncertaintyNarrative } from "@/simulation/impact";
import type { MetricKey, SimulationResult } from "@/simulation/types";

const METRICS: MetricKey[] = [
  "gdpGrowthPct",
  "employmentRatePct",
  "meanIncome",
  "wageIndex",
  "inflationPct",
  "happinessIndex",
  "gini",
  "protestRisk",
  "migrationOutflowPct",
];

function fixture(overrides: Partial<Record<MetricKey, number>> = {}): SimulationResult {
  const point = Object.fromEntries(METRICS.map((m) => [m, 50])) as Record<MetricKey, number>;
  const baseline = Object.fromEntries(METRICS.map((m) => [m, 50])) as Record<MetricKey, number>;
  const uncertainty = Object.fromEntries(
    METRICS.map((m) => [
      m,
      { seedCount: 12, probabilityImproved: 0.92, probabilityChanged: 0.9, medianDelta: 1, p05Delta: -0.2, p95Delta: 2.2 },
    ]),
  ) as SimulationResult["uncertainty"];
  return {
    runId: "run-1",
    seed: 1,
    engine: { bn: "1.1.0", de: "DE/rand1bin", decision: "rule" },
    populationManifest: "abc",
    populationSize: 98923,
    periods: 4,
    point: { ...point, employmentRatePct: 60, ...overrides },
    intervals: Object.fromEntries(METRICS.map((m) => [m, { p05: 0, p50: 50, p95: 100 }])) as SimulationResult["intervals"],
    uncertainty,
    lineageKey: "k",
    byZone: {} as SimulationResult["byZone"],
    baseline: { ...baseline, employmentRatePct: 58 },
    trajectories: {} as SimulationResult["trajectories"],
    distributions: {} as SimulationResult["distributions"],
    paretoFront: [],
    convergence: [],
    causalAttribution: [
      { node: "PolicyType", influence: 1 },
      { node: "IncomeClass", influence: 0.7 },
      { node: "SpendingCapacity", influence: 0.4 },
    ],
    trajectoryTrace: [],
    alerts: [],
    guardrails: [],
    decisionStats: { engine: "rule", calls: 1, escalationRate: 0, meanConfidence: 0.7, fallbackUsed: false },
    validation: [],
    warnings: [],
  } as unknown as SimulationResult;
}

describe("impact language (spec §19, §28)", () => {
  it("labels every metric's direction evidence and magnitude calibration", () => {
    const result = fixture();
    const a = assessMetric(result, "employmentRatePct");
    expect(a.directionStrength).toBe("moderate");
    expect(a.magnitudeCalibration).toBe("uncalibrated");
    expect(a.headline).toMatch(/Direction evidence: moderate/);
    // Never claims a confidence interval (spec §22).
    expect(magnitudeCalibrationFor("employmentRatePct")).toBe("uncalibrated");
  });

  it("leads with a readable, honest impact statement", () => {
    const statement = impactStatement(fixture(), "Housing support");
    expect(statement).toMatch(/^The proposed "Housing support" policy/);
    expect(statement).toMatch(/magnitude is only partially calibrated/);
    expect(statement).not.toMatch(/100% accurate/i);
  });
});

describe("uncertainty narrative (spec §20)", () => {
  it("separates randomness, model and evidence uncertainty", () => {
    const n = uncertaintyNarrative(fixture());
    expect(n.randomness).toMatch(/model ensemble interval, not a statistical confidence interval/);
    expect(n.model).toMatch(/not calibrated/);
    expect(n.evidence).toMatch(/directions are validated/);
    expect(n.summary).toMatch(/uncertain magnitude/);
  });
});

describe("reproducibility info (spec §21)", () => {
  it("exposes engine/calibration versions and a reproducibility id, with seeds as metadata", () => {
    const r = reproducibilityInfo(fixture());
    expect(r.engineVersion).toContain("BN 1.1.0");
    expect(r.reproducibilityId).toBe("run-1");
    expect(r.seedNote).toMatch(/metadata, not policy parameters/);
  });
});
