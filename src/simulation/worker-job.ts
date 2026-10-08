/**
 * The single entry point the Web Worker invokes. It selects the same decision
 * engine the UI would and calls the SAME `runSimulation` used by every direct
 * caller, so the worker result is identical to the direct engine result for the
 * same (policy, seed, population, engine option) inputs.
 */
import { createDecisionEngine } from "./decision";
import { runSimulation } from "./simulate";
import type { Population, SimulationRequest, SimulationResult } from "./types";
import type { SimulationProgress, WorkerJobOptions } from "./worker-protocol";

export interface SimulationJobOptions extends WorkerJobOptions {
  /**
   * Test-only fast path mirroring `SimulationOptions.population`. Never sent
   * across the worker boundary (the worker builds its own population).
   */
  population?: Population;
  onProgress?: (progress: SimulationProgress) => void;
}

export async function runSimulationJob(
  request: SimulationRequest,
  options: SimulationJobOptions = {},
): Promise<SimulationResult> {
  const { engineKind = "rule", remoteEndpoint, onProgress, ...engineOptions } = options;
  const decisionEngine = createDecisionEngine(
    engineKind,
    remoteEndpoint ? { endpoint: remoteEndpoint } : {},
  );
  return runSimulation(request, { ...engineOptions, decisionEngine, onProgress });
}
