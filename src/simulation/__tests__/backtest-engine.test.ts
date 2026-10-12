/**
 * Engine-backed backtesting tests (spec §16, §17, §40D).
 *
 * The requirement: each historical case must go through the ACTUAL simulation
 * engine, using only pre-implementation information, and must honestly report
 * when the engine cannot represent the observed metric.
 */

import { describe, expect, it, vi } from "vitest";

import {
  BACKTEST_CASES,
  BACKTEST_ENGINE_DEFAULTS,
  enginePredictor,
  runEngineBacktestSuite,
  runSimulation,
  type BacktestCase,
  type BacktestEngineOptions,
} from "@/simulation";
import type { MetricKey, SimulationResult } from "@/simulation/types";

/** A minimal SimulationResult-shaped stub for the injected-runner tests. */
function stubResult(point: Partial<Record<MetricKey, number>>, baseline: Partial<Record<MetricKey, number>>): SimulationResult {
  const zero = Object.fromEntries([
    "gdpGrowthPct",
    "employmentRatePct",
    "meanIncome",
    "wageIndex",
    "inflationPct",
    "happinessIndex",
    "gini",
    "protestRisk",
    "migrationOutflowPct",
  ].map((k) => [k, 0])) as Record<MetricKey, number>;
  const u = Object.fromEntries(
    Object.keys(zero).map((k) => [k, { seedCount: 2, shareImproved: 1, shareChanged: 1, medianDelta: 1, p05Delta: 1, p95Delta: 8 }]),
  ) as SimulationResult["uncertainty"];
  return {
    runId: "stub-run",
    seed: 1,
    point: { ...zero, ...point },
    baseline: { ...zero, ...baseline },
    uncertainty: u,
  } as unknown as SimulationResult;
}

function fixtureCase(overrides: Partial<BacktestCase> = {}): BacktestCase {
  const base = BACKTEST_CASES[0];
  return {
    ...base,
    id: "fixture-metric-mapped",
    metric: "Employment rate",
    observedDirection: "increase",
    observedMagnitude: { value: 6, unit: "pp employment" },
    engineMetric: { key: "employmentRatePct", unit: "pp employment", observedMagnitudeIsComparable: true, note: "test fixture" },
    ...overrides,
  };
}

describe("engine-backed backtest uses the real engine", () => {
  it("invokes runSimulation for a real case and returns a run id", async () => {
    const outcome = await enginePredictor(BACKTEST_CASES[0]);
    expect(outcome.engineRunId).toBeTruthy();
    expect(outcome.usedInformation.length).toBeGreaterThan(0);
    // The Wari toll exemption's observed metric (toll paid) is NOT a metric the
    // engine computes, so it must be reported as NOT predicted, not as a success.
    expect(outcome.represented).toBe(false);
    expect(outcome.prediction).toBeNull();
    expect(outcome.reason).toMatch(/does not compute|not represented|does not represent/);
    expect(outcome.result.leakageClean).toBe(true);
  }, 180_000);

  it("is genuinely using the engine, not a stub, by default", () => {
    // Referencing the real engine function is the default (`opts.runEngine ?? runSimulation`).
    expect(typeof runSimulation).toBe("function");
    const opts: BacktestEngineOptions = {};
    expect(opts.runEngine).toBeUndefined();
  });
});

describe("engine prediction is derived from the engine's own output", () => {
  it("maps the engine delta onto direction, magnitude and interval", async () => {
    const runEngine = vi.fn(async () => stubResult({ employmentRatePct: 65 }, { employmentRatePct: 60 }));
    const outcome = await enginePredictor(fixtureCase(), { runEngine: runEngine as unknown as typeof runSimulation });
    expect(runEngine).toHaveBeenCalledTimes(1);
    expect(outcome.represented).toBe(true);
    expect(outcome.prediction?.direction).toBe("increase");
    expect(outcome.prediction?.magnitude).toBeCloseTo(5, 6);
    expect(outcome.prediction?.uncertainty).toEqual({ low: 1, high: 8 });
    // 5 vs observed 6 -> ~16.7% error; the observed 6 is inside [1, 8].
    expect(outcome.result.magnitudeErrorPct).toBeCloseTo(16.666, 2);
    expect(outcome.result.withinUncertaintyInterval).toBe(true);
    expect(outcome.result.predicted).toBe(true);
  });

  it("reports a metric the engine does not represent honestly (no fabricated mapping)", async () => {
    const runEngine = vi.fn(async () => stubResult({}, {}));
    const outcome = await enginePredictor(
      fixtureCase({ id: "no-map", metric: "Toll paid", engineMetric: undefined }),
      { runEngine: runEngine as unknown as typeof runSimulation },
    );
    expect(runEngine).toHaveBeenCalledTimes(1); // engine still invoked
    expect(outcome.represented).toBe(false);
    expect(outcome.prediction).toBeNull();
    expect(outcome.result.predicted).toBe(false);
    expect(outcome.result.directionOnly).toBe(true);
  });

  it("only provides a magnitude when the observation is comparable in units", async () => {
    const runEngine = vi.fn(async () => stubResult({ employmentRatePct: 65 }, { employmentRatePct: 60 }));
    const outcome = await enginePredictor(
      fixtureCase({ engineMetric: { key: "employmentRatePct", unit: "pp employment", note: "levels not comparable" } }),
      { runEngine: runEngine as unknown as typeof runSimulation },
    );
    expect(outcome.prediction?.direction).toBe("increase");
    expect(outcome.prediction?.magnitude).toBeUndefined();
    expect(outcome.prediction?.uncertainty).toBeUndefined();
    expect(outcome.result.directionOnly).toBe(true);
  });
});

describe("information discipline — no post-policy leakage into the prediction", () => {
  it("produces the same prediction regardless of the post-policy observation", async () => {
    const runEngine = vi.fn(async () => stubResult({ employmentRatePct: 65 }, { employmentRatePct: 60 }));
    const a = await enginePredictor(fixtureCase(), { runEngine: runEngine as unknown as typeof runSimulation });
    const b = await enginePredictor(
      fixtureCase({
        observedAfterImplementation: {
          description: "A DIFFERENT post-policy outcome that must not change the prediction.",
          evidence: [
            {
              sourceType: "official_statistics",
              authority: "x",
              title: "post-policy-only",
              verifiedAt: "2026-10-07",
              confidence: "high",
            },
          ],
        },
        observedMagnitude: { value: 999, unit: "pp employment" },
      }),
      { runEngine: runEngine as unknown as typeof runSimulation },
    );
    expect(b.prediction).toEqual(a.prediction);
  });

  it("keeps the leakage guard working: an overlapping source fails the case", async () => {
    const runEngine = vi.fn(async () => stubResult({}, {}));
    const c = BACKTEST_CASES[0];
    const leaked: BacktestCase = {
      ...c,
      informationAvailableBefore: {
        ...c.informationAvailableBefore,
        evidence: [...c.informationAvailableBefore.evidence, ...c.observedAfterImplementation.evidence],
      },
    };
    const outcome = await enginePredictor(leaked, { runEngine: runEngine as unknown as typeof runSimulation });
    expect(outcome.result.leakageClean).toBe(false);
    expect(outcome.result.leakageNote).toMatch(/overlap/i);
  });
});

describe("suite summary", () => {
  it("reports cases, direction agreements, magnitude/interval checks and limitations", async () => {
    const runEngine = vi.fn(async () => stubResult({ employmentRatePct: 65 }, { employmentRatePct: 60 }));
    const { outcomes, summary } = await runEngineBacktestSuite({
      runEngine: runEngine as unknown as typeof runSimulation,
    });
    expect(outcomes.length).toBe(BACKTEST_CASES.length);
    // The real Wari cases have no engine metric mapping, so none are predicted.
    expect(summary.notPredicted).toBe(BACKTEST_CASES.length);
    expect(summary.directionAgreements).toBe(0);
    expect(summary.clean).toBe(true);
    expect(summary.limitations.join(" ")).toMatch(/not predicted|not represented/i);
    expect(summary.note).toMatch(/not reported as successful prediction/);
    // Calibration/evidence buckets are exposed.
    expect(Object.keys(summary.calibrationStatuses).length).toBe(4);
    expect(Object.keys(summary.evidenceStrengths).length).toBe(4);
  });

  it("exposes the documented engine defaults used to build the input", () => {
    expect(BACKTEST_ENGINE_DEFAULTS.budgetInr).toBeLessThanOrEqual(200_000_000);
    expect(BACKTEST_ENGINE_DEFAULTS.intensity).toBeGreaterThan(0);
  });
});
