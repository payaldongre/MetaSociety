/**
 * Impact-language tests (redesign spec §19, §20, §22, §28, §29).
 * Pure: uses a hand-built SimulationResult-shaped fixture, no engine roll.
 */

import { describe, expect, it } from "vitest";

import {
  assessMetric,
  impactStatement,
  magnitudeCalibrationFor,
  reproducibilityInfo,
  seedEnsembleWording,
  uncertaintyNarrative,
} from "@/simulation/impact";
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

function fixture(
  overrides: Partial<Record<MetricKey, number>> = {},
  baselineOverrides: Partial<Record<MetricKey, number>> = {},
): SimulationResult {
  const point = Object.fromEntries(METRICS.map((m) => [m, 50])) as Record<MetricKey, number>;
  const baseline = Object.fromEntries(METRICS.map((m) => [m, 50])) as Record<MetricKey, number>;
  const uncertainty = Object.fromEntries(
    METRICS.map((m) => [
      m,
      { seedCount: 12, improvedShare: 0.92, changedShare: 0.9, medianDelta: 1, p05Delta: -0.2, p95Delta: 2.2 },
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
    baseline: { ...baseline, employmentRatePct: 58, ...baselineOverrides },
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

describe("seed-ensemble wording is never presented as a probability (spec §6, §22)", () => {
  const fixtures = {
    spread: { seedCount: 12, improvedShare: 0.92, changedShare: 0.9, medianDelta: 1, p05Delta: -0.2, p95Delta: 2.2 },
    single: { seedCount: 1, improvedShare: 1, changedShare: 1, medianDelta: 0, p05Delta: 0, p95Delta: 0 },
  };

  it("names the denominator, disclaims probability, and makes no affirmative probability claim", () => {
    for (const [name, u] of Object.entries(fixtures)) {
      for (const metric of ["employmentRatePct", "protestRisk"] as MetricKey[]) {
        const w = seedEnsembleWording(u, metric, (v) => String(v));
        const text = `${w.shareLabel} ${w.shareText} ${w.intervalText}`;
        // No affirmative probability / confidence / accuracy claim.
        expect(text, `${name}/${metric}`).not.toMatch(/\d+% probability/i);
        expect(text, `${name}/${metric}`).not.toMatch(/probability (that|this|the) (policy|scheme)/i);
        expect(text, `${name}/${metric}`).not.toMatch(/confidence level|90% interval|calibrated likelihood|accurate prediction/i);
        // The ensemble is described for what it is: deterministic seed runs.
        expect(text).toMatch(/seed run/i);
      }
    }
    // And it explicitly disclaims probability for the multi-run case.
    const w = seedEnsembleWording(fixtures.spread, "employmentRatePct", (v) => String(v));
    expect(w.shareText).toMatch(/not a probability/i);
    expect(w.intervalText).toMatch(/not a statistical confidence interval/i);
  });

  it("reports the share out of the seed-run count and labels the interval empirical", () => {
    const w = seedEnsembleWording(fixtures.spread, "employmentRatePct", (v) => `${v}`);
    expect(w.shareText).toContain("92%");
    expect(w.shareText).toContain("12");
    expect(w.intervalText).toMatch(/empirical 5th–95th percentile/);
    expect(w.intervalText).toContain("12 seed runs");
  });

  it("refuses to state a probability or interval from a single run", () => {
    const w = seedEnsembleWording(fixtures.single, "employmentRatePct", (v) => String(v));
    expect(w.shareText).toMatch(/no seed-run share is reported/);
    expect(w.intervalText).toMatch(/no seed interval is reported/);
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

/* ------------------------------------------------------------------ */
/* Metric direction: the arrow, the value and the label must agree.     */
/* ------------------------------------------------------------------ */

describe("metric direction is internally consistent (spec §19)", () => {
  type Case = { metric: MetricKey; point: number; baseline: number; movement: string; direction: string };

  // Every metric that appears in the results UI, in both directions. The bug
  // this guards: a metric where LOWER IS BETTER (Gini, protest risk, inflation,
  // migration) falling was reported as an "increase" with an up arrow, and the
  // impact statement then counted the improvement as adverse.
  const cases: Case[] = [
    { metric: "gini", point: 44, baseline: 50, movement: "decrease", direction: "improving" },
    { metric: "gini", point: 56, baseline: 50, movement: "increase", direction: "adverse" },
    { metric: "protestRisk", point: 47, baseline: 50, movement: "decrease", direction: "improving" },
    { metric: "protestRisk", point: 53, baseline: 50, movement: "increase", direction: "adverse" },
    { metric: "inflationPct", point: 53, baseline: 50, movement: "increase", direction: "adverse" },
    { metric: "inflationPct", point: 47, baseline: 50, movement: "decrease", direction: "improving" },
    { metric: "migrationOutflowPct", point: 47, baseline: 50, movement: "decrease", direction: "improving" },
    { metric: "employmentRatePct", point: 52, baseline: 50, movement: "increase", direction: "improving" },
    { metric: "employmentRatePct", point: 48, baseline: 50, movement: "decrease", direction: "adverse" },
    { metric: "gdpGrowthPct", point: 52, baseline: 50, movement: "increase", direction: "improving" },
    { metric: "gdpGrowthPct", point: 48, baseline: 50, movement: "decrease", direction: "adverse" },
    { metric: "meanIncome", point: 60, baseline: 50, movement: "increase", direction: "improving" },
    { metric: "wageIndex", point: 40, baseline: 50, movement: "decrease", direction: "adverse" },
    { metric: "happinessIndex", point: 60, baseline: 50, movement: "increase", direction: "improving" },
    { metric: "happinessIndex", point: 40, baseline: 50, movement: "decrease", direction: "adverse" },
  ];

  it.each(cases)("$metric $movement / $direction", ({ metric, point, baseline, movement, direction }) => {
    const a = assessMetric(fixture({ [metric]: point }, { [metric]: baseline }), metric);
    // The numeric movement follows the SIGN of the delta, nothing else.
    expect(a.movement).toBe(movement);
    expect(Math.sign(a.delta)).toBe(movement === "increase" ? 1 : -1);
    // Desirability follows LOWER_IS_BETTER, independently of the sign.
    expect(a.direction).toBe(direction);
    // The headline must name the numeric direction and must never call an
    // improvement adverse (or vice versa).
    expect(a.headline).toContain(movement);
    if (direction === "adverse") expect(a.headline).toMatch(/adverse/);
    else expect(a.headline).not.toMatch(/adverse/);
  });

  it("a falling Gini coefficient is reported as an improvement, never an increase", () => {
    const a = assessMetric(fixture({ gini: 0.488 }, { gini: 0.5 }), "gini");
    expect(a.movement).toBe("decrease");
    expect(a.direction).toBe("improving");
    expect(a.headline).not.toMatch(/increase/);
    expect(a.headline).not.toMatch(/adverse/);
  });

  it("the impact statement counts a falling Gini coefficient as improving, not adverse", () => {
    // Hold every other metric flat so Gini is the only change.
    const statement = impactStatement(
      fixture({ gini: 44, employmentRatePct: 50 }, { gini: 50, employmentRatePct: 50 }),
      "Falling-inequality policy",
    );
    expect(statement).toMatch(/1 metric\(s\) improve/);
    expect(statement).toMatch(/0 move adversely/);
    expect(statement).toMatch(/improve most of the reported outcomes/);
  });

  it("a materiality threshold below the change size does not flip the classification", () => {
    // Tiny-but-material moves still classify by sign, not by desirability.
    const a = assessMetric(fixture({ protestRisk: 49.9 }, { protestRisk: 50 }), "protestRisk");
    expect(a.movement).toBe("decrease");
    expect(a.direction).toBe("improving");
  });
});
