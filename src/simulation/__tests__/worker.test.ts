/**
 * Web-worker path tests.
 *
 * The worker must NOT re-implement or approximate the engine: it calls the same
 * `runSimulation` the UI would otherwise call directly. These tests pin that
 * down at the exact seam the worker uses (`runSimulationJob`), plus the
 * structured-clone contract that lets the result cross the thread boundary.
 */

import { describe, expect, it } from "vitest";

import { BN_VERSION } from "@/simulation";
import { runSimulation } from "@/simulation/simulate";
import { runSimulationJob } from "@/simulation/worker-job";
import type { SimulationProgress } from "@/simulation/worker-protocol";
import type { PolicyVector, SimulationRequest, SimulationResult } from "@/simulation/types";

const policy: PolicyVector = {
  channelIds: ["INCOME_SUPPORT", "PUBLIC_WORKS"],
  name: "Worker parity probe",
  intensity: 0.65,
  budget: 12e7,
  durationMonths: 12,
  allocation: { housing: 0.3, education: 0.4, employment: 0.3 },
};

const request: SimulationRequest = {
  townId: "pandharpur_in_mh",
  policy,
  mode: "single",
  seed: 20260101,
  bnVersion: BN_VERSION,
  zoneFilter: "all",
};

// Fast but real: the full census-anchored population, no search, one seed round.
const fast = { intervalRounds: 1, skipSearch: true } as const;

function structural(result: SimulationResult) {
  return {
    runId: result.runId,
    seed: result.seed,
    populationSize: result.populationSize,
    periods: result.periods,
    lineageKey: result.lineageKey,
    point: result.point,
    baseline: result.baseline,
    intervals: result.intervals,
    uncertainty: result.uncertainty,
    effectScale: result.ggg?.grounded.effectScale,
    parents: result.ggg?.parents.map((p) => p.policyId),
    traits: result.ggg?.inheritedTraits,
    genome: result.ggg?.genome,
    evidenceStrength: result.ggg?.evidenceStrength,
  };
}

describe("worker simulation path", () => {
  it(
    "the worker job returns the identical result to a direct engine call",
    async () => {
      const direct = await runSimulation(request, { ...fast });
      const viaJob = await runSimulationJob(request, { engineKind: "rule", ...fast });
      expect(structural(viaJob)).toEqual(structural(direct));
      // The grounded effect scale and GGG lineage are present and equal.
      expect(viaJob.ggg?.grounded.effectScale).toBe(direct.ggg?.grounded.effectScale);
      expect(viaJob.ggg?.grounded.effectScale).toBeGreaterThan(0);
    },
    60_000,
  );

  it(
    "emits real engine stages, including the GGG evidence and baseline stages",
    async () => {
      const seen: SimulationProgress[] = [];
      await runSimulationJob(request, { ...fast, onProgress: (p) => seen.push(p) });
      const phases = seen.map((p) => p.phase);
      expect(phases.some((p) => p.includes("historical evidence"))).toBe(true);
      expect(phases.some((p) => p.includes("baseline"))).toBe(true);
      expect(phases.some((p) => p.includes("population trajectory"))).toBe(true);
      // Fractions are the engine's own, bounded and ending at completion.
      expect(seen.every((p) => p.fraction >= 0 && p.fraction <= 1)).toBe(true);
      expect(seen.at(-1)?.fraction).toBe(1);
    },
    60_000,
  );

  it(
    "the result survives a structured clone (what postMessage actually does)",
    async () => {
      const result = await runSimulationJob(request, { ...fast });
      const cloned = structuredClone(result) as SimulationResult;
      expect(cloned.runId).toBe(result.runId);
      expect(cloned.ggg?.grounded.effectScale).toBe(result.ggg?.grounded.effectScale);
      expect(cloned.point).toEqual(result.point);
    },
    60_000,
  );
});
