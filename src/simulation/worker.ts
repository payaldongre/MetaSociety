/**
 * Simulation Web Worker.
 *
 * Receives a `start` message and runs the full engine path off the main thread:
 * policy brief gate -> GGG historical matching/inheritance -> grounded effect
 * scale -> baseline -> proposed -> ensemble -> aggregation -> SimulationResult.
 * Progress is forwarded verbatim from the engine, so every reported stage is a
 * real stage.
 */
import { runSimulationJob } from "./worker-job";
import type { WorkerRequest, WorkerResponse } from "./worker-protocol";

const ctx = self as unknown as {
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
  postMessage: (message: WorkerResponse) => void;
};

ctx.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const data = event.data;
  if (!data || data.type !== "start") return;
  try {
    const result = await runSimulationJob(data.request, {
      ...data.options,
      onProgress: (progress) => ctx.postMessage({ type: "progress", progress }),
    });
    ctx.postMessage({ type: "complete", result });
  } catch (error) {
    ctx.postMessage({
      type: "error",
      message: error instanceof Error ? error.message : String(error),
      name: error instanceof Error ? error.name : undefined,
    });
  }
};
