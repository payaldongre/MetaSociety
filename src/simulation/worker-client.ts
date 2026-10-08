/**
 * Main-thread client for the simulation Web Worker. Spawns the worker, sends a
 * typed `start` message, forwards real progress, and resolves with the engine's
 * `SimulationResult`. Cancellation simply terminates the worker (safe: the run
 * holds no shared state).
 */
import type { SimulationRequest, SimulationResult } from "./types";
import type {
  SimulationProgress,
  WorkerJobOptions,
  WorkerRequest,
  WorkerResponse,
} from "./worker-protocol";

export interface WorkerRunOptions extends WorkerJobOptions {
  onProgress?: (progress: SimulationProgress) => void;
}

export interface WorkerRunHandle {
  promise: Promise<SimulationResult>;
  cancel: () => void;
}

export function runSimulationInWorker(
  request: SimulationRequest,
  options: WorkerRunOptions = {},
): WorkerRunHandle {
  const { onProgress, ...jobOptions } = options;
  const worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
  let settled = false;
  let rejectFn: (reason: Error) => void = () => {};

  const promise = new Promise<SimulationResult>((resolve, reject) => {
    rejectFn = reject;

    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const message = event.data;
      if (message.type === "progress") {
        onProgress?.(message.progress);
        return;
      }
      settled = true;
      worker.terminate();
      if (message.type === "complete") resolve(message.result);
      else reject(new Error(message.message));
    };

    worker.onerror = (event: ErrorEvent) => {
      if (settled) return;
      settled = true;
      worker.terminate();
      reject(new Error(event.message || "Simulation worker failed"));
    };

    const start: WorkerRequest = { type: "start", request, options: jobOptions };
    worker.postMessage(start);
  });

  const cancel = () => {
    if (settled) return;
    settled = true;
    worker.terminate();
    rejectFn(new Error("Simulation cancelled"));
  };

  return { promise, cancel };
}
