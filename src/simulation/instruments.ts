/**
 * Channel → engine bridge.
 *
 * A policy is a NAME plus a SET OF CHANNELS (channel-dictionary.ts). The engine
 * still runs one of a small number of behavioural families, so this module is
 * the single place that maps a channel set onto the family the simulator runs
 * and onto the parameters that family consumes. Keeping the mapping here means
 * the dictionary stays declarative and the engine never has to know about
 * channels by name.
 *
 * A channel marked "declared" in the dictionary has no engine mechanism yet, so
 * it maps to the `none` family. That is deliberate: the engine must NOT silently
 * substitute an unrelated channel for it — the exact failure mode of the original
 * healthcare run. The UI surfaces the "not yet wired" warning for those channels
 * (see `pendingChannelNodes`), so a policy built only from declared channels
 * behaves as the no-policy counterfactual and says why, rather than quietly
 * borrowing another channel's response.
 */

import { CHANNELS, type ChannelDefinition, type ChannelParam } from "./channel-dictionary";
import type { EngineInstrument, MetricKey } from "./types";

type Allocation = { housing: number; education: number; employment: number };

/**
 * The engine family each channel drives. Implemented channels map to the engine
 * mechanism that already models them; declared channels map to "none".
 */
export const CHANNEL_ENGINE_FAMILY: Record<string, EngineInstrument> = {
  INCOME_SUPPORT: "subsidy",
  LABOR_MARKET: "labor",
  HOUSING: "housing",
  EDUCATION_SKILL: "education",
  TAX_FISCAL: "tax",
  REGULATION: "regulation",
  HEALTHCARE_ACCESS: "health",
  DIGITAL_ACCESS: "none",
  ENVIRONMENT_CLIMATE: "none",
  FOOD_SECURITY: "none",
  INFRASTRUCTURE: "none",
  FINANCIAL_INCLUSION: "none",
};

/** Channels that contribute a housing / education / employment allocation split. */
const ALLOCATION_CHANNELS = new Set(["INCOME_SUPPORT", "LABOR_MARKET", "HOUSING", "EDUCATION_SKILL"]);

const NO_ALLOCATION: Allocation = { housing: 0, education: 0, employment: 0 };

/** Default allocation per engine family — used when the split does not apply. */
const FAMILY_ALLOCATION: Record<EngineInstrument, Allocation> = {
  none: NO_ALLOCATION,
  subsidy: { housing: 0.3, education: 0.3, employment: 0.4 },
  labor: { housing: 0.1, education: 0.4, employment: 0.5 },
  housing: { housing: 0.7, education: 0.1, employment: 0.2 },
  education: { housing: 0.1, education: 0.7, employment: 0.2 },
  tax: NO_ALLOCATION,
  regulation: NO_ALLOCATION,
  health: NO_ALLOCATION,
};

/**
 * The engine family a policy runs as: the family of its first IMPLEMENTED
 * channel, or "none" when every selected channel is still declared.
 */
export function engineInstrumentFor(channelIds: string[]): EngineInstrument {
  for (const id of channelIds) {
    const fam = CHANNEL_ENGINE_FAMILY[id];
    if (fam && fam !== "none") return fam;
  }
  return "none";
}

export function hasChannel(channelIds: string[], id: string): boolean {
  return channelIds.includes(id);
}

/** The channel definitions for a channel set, in the order given. */
export function selectedChannels(channelIds: string[]): ChannelDefinition[] {
  return channelIds.map((id) => CHANNELS[id]).filter((c): c is ChannelDefinition => Boolean(c));
}

/** Union of the selected channels' parameters, de-duplicated by key. */
export function channelParams(channelIds: string[]): ChannelParam[] {
  const seen = new Set<string>();
  const out: ChannelParam[] = [];
  for (const ch of selectedChannels(channelIds)) {
    for (const p of ch.parameters) {
      if (!seen.has(p.key)) {
        seen.add(p.key);
        out.push(p);
      }
    }
  }
  return out;
}

/** Union of the selected channels' declared metric targets. */
export function directTargetsFor(channelIds: string[]): MetricKey[] {
  const seen = new Set<MetricKey>();
  for (const ch of selectedChannels(channelIds)) for (const k of ch.directTargets) seen.add(k);
  return [...seen];
}

/** Whether the three-way allocation split applies to a channel set. */
export function channelsUseAllocation(channelIds: string[]): boolean {
  return channelIds.some((id) => ALLOCATION_CHANNELS.has(id));
}

/**
 * The allocation to use: the caller's split when the channels use one, else the
 * engine family's declared default. Allocation genes are therefore ignored —
 * not silently pretended to matter — for tax / regulation / healthcare.
 */
export function allocationFor(channelIds: string[], params: Allocation): Allocation {
  if (channelsUseAllocation(channelIds)) return params;
  return FAMILY_ALLOCATION[engineInstrumentFor(channelIds)] ?? NO_ALLOCATION;
}

/** Selected channels whose effect rests on a BN node that does not exist yet. */
export function pendingChannelNodes(channelIds: string[]): { channelId: string; missingNodes: string[] }[] {
  const out: { channelId: string; missingNodes: string[] }[] = [];
  for (const ch of selectedChannels(channelIds)) {
    if (ch.status === "declared" && ch.bnNodesPending?.length) {
      out.push({ channelId: ch.id, missingNodes: ch.bnNodesPending });
    }
  }
  return out;
}
