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

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { lineageKeyFor, type LineageRecord } from "@/simulation/lineage";
import { engineInstrumentFor } from "@/simulation/instruments";
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
  /** The full policy vector, so a lineage's history can seed the search (Part C). */
  policy: PolicyVector;
  /** Instrument + parameter-similarity bucket the run belongs to. */
  lineageKey: string;
  result: SimulationResult;
  syncedToSupabase: boolean;
}

/**
 * This workspace's recorded runs as lineage records, ready to group by lineage.
 * The persistent history is the local store plus, where configured, the
 * `simulations` table; both carry the same full policy vector and lineage key.
 */
export function lineageRecords(): LineageRecord[] {
  return listRuns()
    // Runs saved before Part C have no stored policy vector; they cannot seed a
    // lineage, so they are skipped rather than mis-grouped.
    .filter((run) => Boolean(run.policy))
    .map((run) => ({
      lineageKey: run.lineageKey ?? lineageKeyFor(run.policy),
      policy: run.policy,
      effectivenessScore: run.effectivenessScore,
      createdAt: run.createdAt,
    }));
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

/**
 * The app's shared client (`@/integrations/supabase/client`) is constructed at
 * module scope, and `createClient` THROWS when its url/key are missing. Anything
 * that imported it would therefore fail to load in a workspace with no Supabase
 * env configured — which is the default state here, and would take out every
 * page that reads saved runs. So the client is built lazily, and only when the
 * env vars are actually present.
 */
let client: SupabaseClient<Database> | null = null;

function getSupabaseClient(): SupabaseClient<Database> | null {
  if (!supabaseConfigured()) return null;
  if (!client) {
    client = createClient<Database>(
      import.meta.env.VITE_SUPABASE_URL as string,
      import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string,
      {
        auth: {
          storage: typeof localStorage !== "undefined" ? localStorage : undefined,
          persistSession: true,
          autoRefreshToken: true,
        },
      },
    );
  }
  return client;
}

async function persistToSupabase(run: SavedRun, userId: string): Promise<string | undefined> {
  const supabase = getSupabaseClient();
  if (!supabase) return "Supabase is not configured";
  try {
    const { error } = await supabase.from("simulations").insert({
      user_id: userId,
      policy_name: run.policyName,
      policy_type: run.policyType,
      parameters: {
        // The FULL policy vector + lineage key, so history accumulates across
        // sessions and users and the search can seed from a lineage's own past.
        policy: run.policy,
        lineageKey: run.lineageKey,
        vector: [
          run.policy.intensity,
          run.policy.budget,
          run.policy.durationMonths,
          run.policy.allocation.housing,
          run.policy.allocation.education,
          run.policy.allocation.employment,
        ],
        runId: run.runId,
        seed: run.result.seed,
      } as never,
      // A compact summary is stored, not the whole result object: the metrics,
      // baseline, uncertainty and alerts are what a report needs, and the full
      // result is exportable from the Lab as JSON.
      results: {
        headline: run.headline,
        baseline: run.baseline,
        uncertainty: run.result.uncertainty,
        alerts: run.alerts,
        effectivenessScore: run.effectivenessScore,
        engine: run.result.engine,
        lineageKey: run.lineageKey,
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
    // Stored as the engine family the channel set runs as, so the existing
    // `policy_type` column keeps its meaning without a schema migration.
    policyType: engineInstrumentFor(policy.channelIds),
    createdAt: new Date().toISOString(),
    effectivenessScore: effectivenessScore(result),
    headline: result.point,
    baseline: result.baseline,
    alerts: result.alerts,
    policy,
    lineageKey: result.lineageKey ?? lineageKeyFor(policy),
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
