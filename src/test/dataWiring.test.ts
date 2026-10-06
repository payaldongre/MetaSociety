/**
 * Wiring tests for the de-mocked pages and run persistence.
 *
 * These exist because of a real defect: `@/integrations/supabase/client`
 * constructs its Supabase client at MODULE SCOPE, and `createClient` throws when
 * the URL/key env vars are missing. Importing it from `runStore` therefore broke
 * every page that reads saved runs in the default (unconfigured) workspace — and
 * a production build does NOT catch it, because a module-scope throw only
 * happens at runtime. The first test below loads those page modules, so it fails
 * loudly if that import ever comes back.
 *
 * This file lives in the `app` vitest project (jsdom), which `vitest.config.ts`
 * keeps separate from the CPU-heavy simulation project.
 */

import { afterEach, describe, expect, it } from "vitest";

import { effectivenessScore, listRuns, saveRun, supabaseConfigured } from "@/lib/runStore";
import { isResultsStale } from "@/pages/SimulationLab";
import type { PolicyVector, SimulationResult } from "@/simulation/types";

const POLICY: PolicyVector = {
  channelIds: ["INCOME_SUPPORT"],
  name: "Wiring test subsidy",
  intensity: 0.6,
  budget: 5_000_000,
  durationMonths: 6,
  allocation: { housing: 0.2, education: 0.3, employment: 0.5 },
};

/** A minimally-shaped result: enough for persistence, not a real engine run. */
function fakeResult(): SimulationResult {
  return {
    runId: "wiring-test-run",
    seed: 7,
    engine: { bn: "1.0.0", de: null, decision: "rule" },
    point: {
      gdpGrowthPct: 3,
      employmentRatePct: 62,
      meanIncome: 9000,
      wageIndex: 12000,
      inflationPct: 4,
      happinessIndex: 55,
      gini: 0.4,
      protestRisk: 10,
      migrationOutflowPct: 0.5,
    },
    baseline: {
      gdpGrowthPct: 1,
      employmentRatePct: 60,
      meanIncome: 8500,
      wageIndex: 11500,
      inflationPct: 4.2,
      happinessIndex: 52,
      gini: 0.41,
      protestRisk: 11,
      migrationOutflowPct: 0.4,
    },
    alerts: [],
  } as unknown as SimulationResult;
}

afterEach(() => {
  localStorage.clear();
});

describe("de-mocked pages load without Supabase configured", () => {
  it("imports every page that reads saved runs or real town data", async () => {
    const modules = await Promise.all([
      import("@/pages/Dashboard"),
      import("@/pages/DataIntelligence"),
      import("@/pages/Alerts"),
      import("@/pages/SavedReports"),
      import("@/pages/SimulationLab"),
    ]);
    for (const mod of modules) {
      expect(typeof mod.default).toBe("function");
    }
  });

  it("reports Supabase configuration as a fact rather than throwing", () => {
    expect(typeof supabaseConfigured()).toBe("boolean");
  });
});

describe("run persistence", () => {
  it("saves a run locally and reads it back, even with no Supabase env", async () => {
    const outcome = await saveRun(fakeResult(), POLICY);
    // Without env vars (or without a user id) the local store is the honest answer.
    expect(outcome.storage).toBe("local");

    const runs = listRuns();
    expect(runs).toHaveLength(1);
    expect(runs[0].policyName).toBe(POLICY.name);
    expect(runs[0].policyType).toBe("subsidy");
    expect(runs[0].runId).toBe("wiring-test-run");
    expect(runs[0].headline.employmentRatePct).toBe(62);
    expect(runs[0].baseline.employmentRatePct).toBe(60);
  });

  it("stores the computed effectiveness score, not a hardcoded one", async () => {
    const before = effectivenessScore(fakeResult());
    await saveRun(fakeResult(), POLICY);
    expect(listRuns()[0].effectivenessScore).toBe(before);
    // The fake policy improves employment/GDP/happiness and lowers inflation,
    // inequality and protest risk, so it must score above the "no change" 50.
    expect(before).toBeGreaterThan(50);
    expect(before).toBeLessThanOrEqual(100);
  });

  it("is deterministic and bounded for a given result", () => {
    expect(effectivenessScore(fakeResult())).toBe(effectivenessScore(fakeResult()));
  });

  it("survives a stale or corrupt stored payload", () => {
    localStorage.setItem("meta_society_simulations", "{not json");
    expect(listRuns()).toEqual([]);
  });
});

describe("stale-results indicator", () => {
  it("is silent before any run, and after a run that matches the current config", () => {
    expect(isResultsStale(null, "subsidy|65|120000000|24")).toBe(false);
    expect(isResultsStale("subsidy|65|120000000|24", "subsidy|65|120000000|24")).toBe(false);
  });

  it("flags results as out of date whenever any policy input changes", () => {
    const ran = "subsidy|65|120000000|24";
    // Duration dragged from 24 to 39 months, name edited, intensity moved.
    expect(isResultsStale(ran, "subsidy|65|120000000|39")).toBe(true);
    expect(isResultsStale(ran, "subsidy|50|120000000|24")).toBe(true);
    expect(isResultsStale(ran, "housing|65|120000000|24")).toBe(true);
  });
});
