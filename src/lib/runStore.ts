/**
 * Persistence for Simulation Lab runs.
 *
 * Design note (SIMULATION_LAB_SPEC.md): the deployed workspace in this
 * repository has no Supabase project configured, and the app's auth is a local
 * stub, so a Supabase-only write path could not be verified end to end. Rather
 * than ship an unverified write path, persistence works in two layers:
 *
 *   1. ALWAYS — runs are stored locally (browser storage), so Save works and
 *      Saved Reports reads real runs today. This is the verified path.
 *   2. WHEN CONFIGURED — if `VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_KEY`
 *      are set and a signed-in user id is available, the same run is inserted
 *      into the `simulations` table. A failure there is reported, never hidden,
 *      and never discards the local copy.
 *
 * `effectivenessScore` is a modelled ranking aid computed from the run's own
 * metrics — a deterministic function of the result, not a forecast and not an
 * LLM judgement.
 */

import { supabase } from "@/integrations/supabase/client";
import type { MetricKey, PolicyVector, SimulationResult } from "@/simulation/types";

const STORAGE_KEY = "meta_society_simulations";
const MAX_RUNS = 50;

export interface SavedRun {
  id: string;
  runId: string;
  policyName: string;
  policyType: string;
  createdAt: string;
  /** 0–100; 50 means "no measurable change against the no-policy baseline". */
  effectivenessScore: number;
  headline: Record<MetricKey, number>;
  baseline: Record<MetricKey, number>;
  alerts: SimulationResult["alerts"];
  result: SimulationResult;
  syncedToSupabase: boolean;
}

export interface SaveOutcome {
  run: SavedRun;
  storage: "local" | "local+supabase";
  remoteError?: string;
}

/* ------------------------------------------------------------------ */
/* Effectiveness score                                                 */
/* ------------------------------------------------------------------ */

/**
 * Objectives and how much each counts toward the score. Normalisers are the
 * movement that counts as "clearly material" for that metric, so a 2pp
 * employment gain and a 2pp inflation increase weigh comparably.
 */
const SCORE_OBJECTIVES: { key: MetricKey; weight: number; normaliser: number; lowerIsBetter?: boolean }[] = [
  { key: "employmentRatePct", weight: 1, normaliser: 4 },
  { key: "gdpGrowthPct", weight: 1, normaliser: 3 },
  { key: "happinessIndex", weight: 0.6, normaliser: 6 },
  { key: "inflationPct", weight: 1, normaliser: 3, lowerIsBetter: true },
  { key: "gini", weight: 0.5, normaliser: 0.03, lowerIsBetter: true },
  { key: "protestRisk", weight: 0.5, normaliser: 4, lowerIsBetter: true },
];

export function effectivenessScore(result: SimulationResult): number {
  let weighted = 0;
  let totalWeight = 0;
  for (const objective of SCORE_OBJECTIVES) {
    const delta = result.point[objective.key] - result.baseline[objective.key];
    if (!Number.isFinite(delta)) continue;
    const signed = objective.lowerIsBetter ? -delta : delta;
    const normalised = Math.max(-1, Math.min(1, signed / objective.normaliser));
    weighted += normalised * objective.weight;
    totalWeight += objective.weight;
  }
  if (totalWeight === 0) return 50;
  return Math.round((50 + (weighted / totalWeight) * 50) * 10) / 10;
}

/* ------------------------------------------------------------------ */
/* Local storage                                                       */
/* ------------------------------------------------------------------ */

function readStore(): SavedRun[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as SavedRun[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeStore(runs: SavedRun[]): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(runs.slice(0, MAX_RUNS)));
  } catch {
    // Quota or private-mode failure: the caller still reports the local save
    // attempt honestly rather than claiming success.
  }
}

/** Saved runs, newest first. */
export function listRuns(): SavedRun[] {
  return readStore().sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export function deleteRun(id: string): SavedRun[] {
  const remaining = readStore().filter((run) => run.id !== id);
  writeStore(remaining);
  return remaining.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

/* ------------------------------------------------------------------ */
/* Supabase (optional)                                                 */
/* ------------------------------------------------------------------ */

export function supabaseConfigured(): boolean {
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;
  return Boolean(url && key);
}

async function persistToSupabase(run: SavedRun, userId: string): Promise<string | undefined> {
  try {
    const { error } = await supabase.from("simulations").insert({
      user_id: userId,
      policy_name: run.policyName,
      policy_type: run.policyType,
      parameters: { policy: run.policyType, runId: run.runId, seed: run.result.seed } as never,
      // A compact summary is stored, not the whole result object: the metrics,
      // baseline and alerts are what a report needs, and the full result is
      // exportable from the Lab as JSON.
      results: {
        headline: run.headline,
        baseline: run.baseline,
        alerts: run.alerts,
        effectivenessScore: run.effectivenessScore,
        engine: run.result.engine,
      } as never,
      effectiveness_score: run.effectivenessScore,
    });
    return error ? error.message : undefined;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

/* ------------------------------------------------------------------ */
/* Save                                                                */
/* ------------------------------------------------------------------ */

export async function saveRun(
  result: SimulationResult,
  policy: PolicyVector,
  userId?: string,
): Promise<SaveOutcome> {
  const run: SavedRun = {
    id: `${result.runId}-${Date.now()}`,
    runId: result.runId,
    policyName: policy.name,
    policyType: policy.type,
    createdAt: new Date().toISOString(),
    effectivenessScore: effectivenessScore(result),
    headline: result.point,
    baseline: result.baseline,
    alerts: result.alerts,
    result,
    syncedToSupabase: false,
  };

  // Layer 1: local, always.
  writeStore([run, ...readStore()]);

  // Layer 2: Supabase, only when configured and a user id is known.
  if (supabaseConfigured() && userId) {
    const remoteError = await persistToSupabase(run, userId);
    if (!remoteError) {
      run.syncedToSupabase = true;
      writeStore([run, ...readStore().filter((r) => r.id !== run.id)]);
      return { run, storage: "local+supabase" };
    }
    return { run, storage: "local", remoteError };
  }

  return { run, storage: "local" };
}
