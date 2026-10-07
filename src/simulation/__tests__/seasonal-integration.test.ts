/**
 * Integration test: the Wari seasonal overlay reaches the real run result
 * (redesign spec §10, §12, §38).
 *
 * Two full-population runs, deliberately small (short policy, 1 ensemble round,
 * no search) so the suite stays within its worker budget.
 */

import { describe, expect, it } from "vitest";

import { BN_VERSION, runSimulation } from "@/simulation";
import type { PolicyVector, SimulationRequest } from "@/simulation";

const policy = (channelIds: string[], name: string): PolicyVector => ({
  channelIds,
  name,
  intensity: 0.8,
  budget: 50_000_000,
  durationMonths: 12,
  allocation: { housing: channelIds.includes("HOUSING") ? 1 : 0, education: 0, employment: 0 },
});

const request = (p: PolicyVector): SimulationRequest => ({
  townId: "pandharpur_in_mh",
  policy: p,
  mode: "single",
  seed: 424242,
  bnVersion: BN_VERSION,
});

const opts = { searchAgents: 40, intervalRounds: 1, skipSearch: true } as const;

describe("Wari seasonal effect in a real run", () => {
  it("a seasonal pilgrimage policy shows a visible Wari step", async () => {
    const result = await runSimulation(request(policy(["PILGRIMAGE_FACILITIES"], "Wari facilities")), opts);
    expect(result.seasonality).toBeTruthy();
    const s = result.seasonality!;
    expect(s.policyCarriesPilgrimage).toBe(true);
    expect(s.points.some((p) => p.inWari)).toBe(true);
    expect(s.wariStep).toBeGreaterThan(0.05);
    expect(s.peakPressure).toBeGreaterThan(0);
    // The policy's mean seasonal pressure differs from the no-policy baseline.
    expect(s.policyMeanPressure).not.toBe(s.baselineMeanPressure);
  }, 180_000);

  it("a general housing policy acquires NO pilgrimage effect", async () => {
    const result = await runSimulation(request(policy(["HOUSING"], "Housing support")), opts);
    const s = result.seasonality!;
    expect(s.policyCarriesPilgrimage).toBe(false);
    // Identical seasonal profile to the baseline → no pilgrimage term anywhere.
    expect(s.policyMeanPressure).toBe(s.baselineMeanPressure);
    for (const p of s.points) expect(p.policyPressure).toBe(p.baselinePressure);
  }, 180_000);
});
