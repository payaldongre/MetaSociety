/**
 * Lineage grouping for the evolutionary search (SPEC §11, Part C).
 *
 * The search was originally stateless: every run started from scratch and every
 * result was only ever compared against the no-policy baseline. Part C adds two
 * things, both of which need a stable notion of "which kind of policy is this":
 *
 *   1. a LINEAGE KEY — the policy's channel set plus a coarse parameter-similarity
 *      bucket, so runs are grouped by what they are, not pooled into one shared
 *      gene pool;
 *   2. a similarity metric, so a lineage's own history can seed the search and
 *      a candidate can be compared against the previous best of ITS lineage
 *      rather than only against doing nothing.
 *
 * A healthcare lineage must never inherit traits from a regulation lineage;
 * because the key is prefixed with the sorted channel set, it never can.
 */

import { REFERENCE_BUDGET } from "./simulate";
import type { PolicyVector } from "./types";

/** Coarsen a value into a small ordinal band, given ascending cut points. */
function bandIndex(value: number, cuts: number[]): number {
  let i = 0;
  while (i < cuts.length && value >= cuts[i]) i += 1;
  return i;
}

/** Sorted channel set as a stable key segment; "none" for an empty set. */
function channelKeyOf(policy: PolicyVector): string {
  return policy.channelIds.length > 0 ? [...policy.channelIds].sort().join("+") : "none";
}

/**
 * The lineage key: the sorted channel set, then intensity / budget-share /
 * duration bands. The channel-set prefix is what guarantees cross-channel
 * isolation.
 */
export function lineageKeyFor(policy: PolicyVector): string {
  const intensity = bandIndex(policy.intensity, [0.4, 0.72]);
  const budget = bandIndex(policy.budget / REFERENCE_BUDGET, [0.25, 0.6]);
  const duration = policy.durationMonths <= 12 ? 0 : policy.durationMonths <= 36 ? 1 : 2;
  return `${channelKeyOf(policy)}|${intensity}|${budget}|${duration}`;
}

/** Human-readable parts of a lineage key. */
export function describeLineageKey(key: string): { channels: string; bands: string } {
  const [channels, intensity, budget, duration] = key.split("|");
  const I = ["low", "medium", "high"];
  const D = ["short", "medium", "long"];
  return {
    channels: channels ?? "unknown",
    bands: `${I[Number(intensity)] ?? "?"} intensity · ${I[Number(budget)] ?? "?"} budget · ${D[Number(duration)] ?? "?"}`,
  };
}

/**
 * Normalised distance in [0,1] between two policies, used to order a lineage's
 * history and to keep a lineage from drifting into a different instrument.
 * Returns 1 (maximally distant) for two different instruments.
 */
export function policyDistance(a: PolicyVector, b: PolicyVector): number {
  if (channelKeyOf(a) !== channelKeyOf(b)) return 1;
  const di = Math.abs(a.intensity - b.intensity);
  const db = Math.abs(a.budget - b.budget) / REFERENCE_BUDGET;
  const dd = Math.abs(a.durationMonths - b.durationMonths) / 60;
  const alloc = (p: PolicyVector) => [p.allocation.housing, p.allocation.education, p.allocation.employment];
  const [ah, ae, aw] = alloc(a);
  const [bh, be, bw] = alloc(b);
  const da = (Math.abs(ah - bh) + Math.abs(ae - be) + Math.abs(aw - bw)) / 2;
  return Math.min(1, (di + db + dd + da) / 4);
}

export interface LineageRecord {
  lineageKey: string;
  policy: PolicyVector;
  /** 0–100 effectiveness score of the recorded run, when known. */
  effectivenessScore?: number;
  createdAt?: string;
}

/**
 * The lineage's own history, ordered best-first, ready to seed the search.
 * Only records whose key matches (same instrument AND same band bucket) are
 * returned, so the optimizer's inheritance pool is lineage-local by construction.
 */
export function lineageHistory(records: LineageRecord[], key: string): LineageRecord[] {
  return records
    .filter((r) => r.lineageKey === key)
    .sort((a, b) => (b.effectivenessScore ?? -Infinity) - (a.effectivenessScore ?? -Infinity));
}

/** The best recorded run in a lineage, or null if the lineage has no history. */
export function bestInLineage(records: LineageRecord[], key: string): LineageRecord | null {
  const history = lineageHistory(records, key);
  return history.length > 0 ? history[0] : null;
}
