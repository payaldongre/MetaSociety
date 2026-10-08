/**
 * Typed protocol between the UI and the simulation Web Worker.
 *
 * The worker runs the ONE simulation implementation (`runSimulationJob` ->
 * `runSimulation`) off the main thread. Nothing here re-implements or
 * approximates the engine: the worker receives the same `SimulationRequest` the
 * main thread would have passed directly, and returns the same
 * `SimulationResult` the direct call produces.
 */
import type { SimulationRequest, SimulationResult } from "./types";
import type { DecisionEngineKind } from "./decision";

/**
 * A real progress step. `phase` and `fraction` come straight from
 * `runSimulation`'s own `onProgress` — they are the engine's actual stages, not
 * a decorative animation clock.
 */
export interface SimulationProgress {
  phase: string;
  fraction: number;
  detail?: string;
}

/**
 * Engine options that are safe to send across the worker boundary. The
 * population is deliberately absent: the worker generates the identical
 * census-anchored population itself (same seed -> same agents), so tens of
 * thousands of agents are never serialized between threads.
 */
export interface WorkerJobOptions {
  engineKind?: DecisionEngineKind;
  remoteEndpoint?: string;
  lineageSeeds?: number[][];
  searchAgents?: number;
  searchPeriods?: number;
  dePopulation?: number;
  deGenerations?: number;
  skipSearch?: boolean;
  intervalRounds?: number;
}

/** Main thread -> worker. */
export type WorkerRequest = {
  type: "start";
  request: SimulationRequest;
  options: WorkerJobOptions;
};

/** Worker -> main thread. */
export type WorkerResponse =
  | { type: "progress"; progress: SimulationProgress }
  | { type: "complete"; result: SimulationResult }
  | { type: "error"; message: string; name?: string };
