/**
 * Wari seasonal pilgrimage model (spec §9, §11, §12, §13).
 *
 * THE CORE DISTINCTION. Pilgrims are NEVER added to the resident population.
 * The model represents:
 *
 *     resident population  +  TEMPORARY seasonal pressure
 *
 * `PilgrimFootfall` is temporary visitor pressure; `SeasonalInfraLoad` is the
 * resulting infrastructure/civic pressure; `LocalInfraQuality` is the local
 * infrastructure policy's effect on the town's capacity to absorb it.
 *
 * WHY THESE NODES LIVE IN A PARALLEL REGISTRY, NOT IN THE CORE BAYESIAN NETWORK
 * (a deliberate conflict resolution, spec §41). The core BN draws its nodes from
 * a single RNG stream and the repository asserts byte-identical reproducibility
 * for a given seed. Adding root nodes to the core network would consume draws
 * and shift every established node's uniforms, silently rewriting the validated
 * network — breaking an existing invariant to satisfy a new requirement. So the
 * pilgrimage nodes are registered here with the SAME declarative shape the core
 * registry uses (domain, parents, pass, cptSource, provenance, modelled,
 * calibration status) and are evaluated by exact enumeration from a dedicated,
 * isolated code path. They are therefore fully inspectable without perturbing
 * the network the rest of the repository was validated against.
 *
 * CALIBRATION (spec §13). Only the DIRECTION of each relationship is asserted.
 * Every magnitude below is a MODEL ASSUMPTION and is labelled `uncalibrated`;
 * the seasonal footfall scale is anchored to documented Wari counts (see the
 * calibration ledger), but the mapping from footfall to civic pressure is not
 * calibrated against an evaluated programme.
 */

import { source, type CalibrationStatus, type SourceRecord } from "./evidence";

/* ------------------------------------------------------------------ */
/* Vocabularies                                                        */
/* ------------------------------------------------------------------ */

export const PILGRIM_SEASONS = ["off", "shoulder", "peak_wari"] as const;
export type PilgrimSeason = (typeof PILGRIM_SEASONS)[number];

export const PILGRIM_EXPOSURES = ["none", "limited", "full"] as const;
export type PilgrimExposure = (typeof PILGRIM_EXPOSURES)[number];

export const FOOTFALL_BANDS = ["low", "moderate", "high", "very_high"] as const;
export type FootfallBand = (typeof FOOTFALL_BANDS)[number];

export const INFRA_LOAD_BANDS = ["low", "moderate", "high", "severe"] as const;
export type InfraLoadBand = (typeof INFRA_LOAD_BANDS)[number];

export const LOCAL_INFRA_POLICIES = ["constrained", "steady", "expanded"] as const;
export type LocalInfraPolicy = (typeof LOCAL_INFRA_POLICIES)[number];

export const QUALITY_BANDS = ["poor", "adequate", "good"] as const;
export type QualityBand = (typeof QUALITY_BANDS)[number];

/** Channel id that drives the pilgrimage-facilities exposure. */
export const PILGRIMAGE_CHANNEL_ID = "PILGRIMAGE_FACILITIES";

/* ------------------------------------------------------------------ */
/* The Wari calendar                                                   */
/* ------------------------------------------------------------------ */

/**
 * Ashadha (Ashadhi Ekadashi) falls in June–July. `monthOfYear` is 1–12.
 * `off` outside, `shoulder` on the approaching/leaving months.
 */
export const WARI_CALENDAR = {
  peakMonths: [6, 7],
  shoulderMonths: [5, 8],
} as const;

const WARI_FOOTFALL_SOURCE: SourceRecord = source({
  sourceType: "official_statistics",
  authority: "Solapur Rural Police (reported)",
  title: "Ashadhi Wari footfall — ~27–28 lakh on Ekadashi (2025); ~32 lakh over 3 days (2026)",
  date: "2026-07-27",
  url: "https://timesofindia.indiatimes.com/city/kolhapur/32-lakh-devotees-visited-pandharpur-during-3-day-ashadi-ekadashi-fest/articleshow/132667935.cms",
  measurementPeriod: "Ashadhi Ekadashi 2025 and 2026",
  referenceYear: 2026,
  confidence: "moderate",
  notes: "Police/drone estimates. Used to anchor which parameter is real; the pressure mapping itself is not calibrated.",
});

export function seasonForMonthOfYear(monthOfYear: number): PilgrimSeason {
  const m = ((monthOfYear - 1) % 12) + 1;
  if ((WARI_CALENDAR.peakMonths as readonly number[]).includes(m)) return "peak_wari";
  if ((WARI_CALENDAR.shoulderMonths as readonly number[]).includes(m)) return "shoulder";
  return "off";
}

export function monthOfYearFor(month: number, startMonth: number): number {
  return (((startMonth - 1 + month) % 12) + 12) % 12 + 1;
}

/** Exposure implied by a policy's channels and intensity. */
export function pilgrimageExposureFor(channelIds: string[], intensity: number): PilgrimExposure {
  if (!channelIds.includes(PILGRIMAGE_CHANNEL_ID)) return "none";
  return intensity >= 0.66 ? "full" : "limited";
}

/** Local infrastructure policy implied by the policy's channels. */
export function localInfraPolicyFor(channelIds: string[]): LocalInfraPolicy {
  if (channelIds.includes("INFRASTRUCTURE")) return "expanded";
  if (channelIds.includes(PILGRIMAGE_CHANNEL_ID)) return "steady";
  return "constrained";
}

/* ------------------------------------------------------------------ */
/* Declarative node registry (spec §11)                                */
/* ------------------------------------------------------------------ */

export type SeasonalPass = "seasonal";

/** Same shape the core BN's `NodeSpec` uses, plus a calibration status. */
export interface SeasonalNodeSpec {
  id: string;
  domain: string[];
  parents: string[];
  pass: SeasonalPass;
  root: boolean;
  cptSource: "observed" | "prior" | "derived";
  /** Where the conditional structure comes from. */
  provenance: string;
  /** True when the conditional structure is a flagged modelling assumption. */
  modelled: boolean;
  calibrationStatus: CalibrationStatus;
  note: string;
}

export const PILGRIMAGE_NODE_REGISTRY: SeasonalNodeSpec[] = [
  {
    id: "PilgrimFootfall",
    domain: [...FOOTFALL_BANDS],
    parents: ["PilgrimSeason", "PilgrimPolicyExposure"],
    pass: "seasonal",
    root: false,
    cptSource: "prior",
    provenance: "prior:assumption+official_statistics (seasonal scale anchored to Wari counts)",
    modelled: true,
    calibrationStatus: "limited",
    note: "Temporary visitor pressure. Direction of the seasonal effect is anchored to documented Wari footfall; the band edges are a model assumption.",
  },
  {
    id: "SeasonalInfraLoad",
    domain: [...INFRA_LOAD_BANDS],
    parents: ["PilgrimFootfall"],
    pass: "seasonal",
    root: false,
    cptSource: "prior",
    provenance: "prior:assumption",
    modelled: true,
    calibrationStatus: "uncalibrated",
    note: "Infrastructure/civic pressure caused by the temporary load. Direction only; magnitude uncalibrated.",
  },
  {
    id: "LocalInfraQuality",
    domain: [...QUALITY_BANDS],
    parents: ["LocalInfraPolicy"],
    pass: "seasonal",
    root: false,
    cptSource: "prior",
    provenance: "prior:assumption",
    modelled: true,
    calibrationStatus: "uncalibrated",
    note: "Effect of the local infrastructure policy on the town's absorption capacity.",
  },
];

/** Roots the seasonal model reads (defined here so the registry is complete). */
export const SEASONAL_ROOT_SPECS: SeasonalNodeSpec[] = [
  {
    id: "PilgrimSeason",
    domain: [...PILGRIM_SEASONS],
    parents: [],
    pass: "seasonal",
    root: true,
    cptSource: "derived",
    provenance: "derived_from_calendar (Ashadha ~ June–July)",
    modelled: true,
    calibrationStatus: "limited",
    note: "Season assigned deterministically from the simulated calendar month.",
  },
  {
    id: "PilgrimPolicyExposure",
    domain: [...PILGRIM_EXPOSURES],
    parents: [],
    pass: "seasonal",
    root: true,
    cptSource: "derived",
    provenance: "derived_from_policy_channels",
    modelled: true,
    calibrationStatus: "limited",
    note: "Derived from whether the policy touches the pilgrimage-facilities channel and at what intensity.",
  },
  {
    id: "LocalInfraPolicy",
    domain: [...LOCAL_INFRA_POLICIES],
    parents: [],
    pass: "seasonal",
    root: true,
    cptSource: "derived",
    provenance: "derived_from_policy_channels",
    modelled: true,
    calibrationStatus: "limited",
    note: "Derived from the policy's infrastructure/pilgrimage channels.",
  },
];

/** Full registry including roots. */
export const SEASONAL_NODES: SeasonalNodeSpec[] = [...SEASONAL_ROOT_SPECS, ...PILGRIMAGE_NODE_REGISTRY];

/* ------------------------------------------------------------------ */
/* CPTs — deterministic, enumerated, documented                        */
/* ------------------------------------------------------------------ */

/** Footfall distribution given (season, exposure). Rows sum to 1. */
export const FOOTFALL_CPT: Record<string, number[]> = {
  "off|none": [0.85, 0.13, 0.02, 0.0],
  "off|limited": [0.8, 0.16, 0.04, 0.0],
  "off|full": [0.75, 0.2, 0.05, 0.0],
  "shoulder|none": [0.25, 0.6, 0.15, 0.0],
  "shoulder|limited": [0.2, 0.58, 0.2, 0.02],
  "shoulder|full": [0.15, 0.55, 0.25, 0.05],
  "peak_wari|none": [0.02, 0.13, 0.5, 0.35],
  "peak_wari|limited": [0.01, 0.1, 0.49, 0.4],
  "peak_wari|full": [0.005, 0.075, 0.42, 0.5],
};

/** Infra load given footfall. Rows sum to 1. */
export const LOAD_CPT: Record<string, number[]> = {
  low: [0.8, 0.18, 0.02, 0.0],
  moderate: [0.2, 0.6, 0.18, 0.02],
  high: [0.03, 0.17, 0.6, 0.2],
  very_high: [0.01, 0.09, 0.4, 0.5],
};

/** Local infra quality given the local infra policy. Rows sum to 1. */
export const QUALITY_CPT: Record<string, number[]> = {
  constrained: [0.7, 0.25, 0.05],
  steady: [0.2, 0.65, 0.15],
  expanded: [0.05, 0.3, 0.65],
};

/** Expected band value (0..1) used to turn a distribution into a number. */
const FOOTFALL_VALUE = [0.15, 0.4, 0.7, 1.0];
const LOAD_VALUE = [0.15, 0.4, 0.7, 1.0];
const QUALITY_MITIGATION = [0.0, 0.25, 0.45];

function expected(cpt: Record<string, number[]>, key: string, values: number[]): number {
  const row = cpt[key];
  if (!row) return 0;
  return row.reduce((acc, p, i) => acc + p * (values[i] ?? 0), 0);
}

/* ------------------------------------------------------------------ */
/* Point + profile                                                     */
/* ------------------------------------------------------------------ */

export interface SeasonalPoint {
  period: number;
  month: number;
  monthOfYear: number;
  season: PilgrimSeason;
  exposure: PilgrimExposure;
  /** Expected visitor-pressure index, 0..1. */
  footfall: number;
  /** Expected infrastructure-load index before mitigation, 0..1. */
  infraLoad: number;
  /** Expected local-infrastructure quality index, 0..1. */
  infraQuality: number;
  /** Net civic pressure after mitigation, 0..1. */
  civicPressure: number;
  /** True during the modelled Wari window. */
  inWari: boolean;
}

/**
 * Evaluate one seasonal point for a given month, exposure and infra policy.
 * Pure and deterministic — no RNG.
 */
export function seasonalPoint(
  period: number,
  month: number,
  monthOfYear: number,
  exposure: PilgrimExposure,
  infraPolicy: LocalInfraPolicy,
): SeasonalPoint {
  const season = seasonForMonthOfYear(monthOfYear);
  const footfall = expected(FOOTFALL_CPT, `${season}|${exposure}`, FOOTFALL_VALUE);
  // Infra load is the expected load band given the footfall distribution.
  const footfallRow = FOOTFALL_CPT[`${season}|${exposure}`];
  let infraLoad = 0;
  for (let f = 0; f < FOOTFALL_BANDS.length; f += 1) {
    infraLoad += (footfallRow[f] ?? 0) * expected(LOAD_CPT, FOOTFALL_BANDS[f], LOAD_VALUE);
  }
  const infraQuality = expected(QUALITY_CPT, infraPolicy, [0.25, 0.6, 0.9]);
  const mitigation = infraQuality * 0.5;
  const civicPressure = infraLoad * (1 - mitigation);
  return {
    period,
    month,
    monthOfYear,
    season,
    exposure,
    footfall,
    infraLoad,
    infraQuality,
    civicPressure,
    inWari: season === "peak_wari",
  };
}

export interface SeasonalProfile {
  startMonth: number;
  monthsEach: number;
  exposure: PilgrimExposure;
  infraPolicy: LocalInfraPolicy;
  points: SeasonalPoint[];
  /** Measured step: mean Wari-period pressure minus mean non-Wari pressure. */
  wariStep: number;
  /** Peak pressure observed anywhere in the profile. */
  peakPressure: number;
}

export interface SeasonalProfileInput {
  periods: number;
  monthsEach: number;
  startMonth: number;
  channelIds: string[];
  intensity: number;
}

export function buildSeasonalProfile(input: SeasonalProfileInput): SeasonalProfile {
  const exposure = pilgrimageExposureFor(input.channelIds, input.intensity);
  const infraPolicy = localInfraPolicyFor(input.channelIds);
  const points: SeasonalPoint[] = [];
  for (let p = 0; p < input.periods; p += 1) {
    const month = (p + 1) * input.monthsEach;
    const monthOfYear = monthOfYearFor(month, input.startMonth);
    points.push(seasonalPoint(p, month, monthOfYear, exposure, infraPolicy));
  }
  const wari = points.filter((x) => x.inWari);
  const nonWari = points.filter((x) => !x.inWari);
  const mean = (a: SeasonalPoint[]) => (a.length ? a.reduce((s, x) => s + x.civicPressure, 0) / a.length : 0);
  const wariStep = mean(wari) - mean(nonWari);
  const peakPressure = points.reduce((m, x) => Math.max(m, x.civicPressure), 0);
  return { startMonth: input.startMonth, monthsEach: input.monthsEach, exposure, infraPolicy, points, wariStep, peakPressure };
}

/* ------------------------------------------------------------------ */
/* Overlay onto headline metrics (spec §28)                            */
/* ------------------------------------------------------------------ */

/**
 * Sensitivity of the town's headline sentiment to seasonal civic pressure.
 * MODEL ASSUMPTION, uncalibrated: only the sign is asserted (more pressure ->
 * lower happiness, higher protest risk).
 */
export const SEASONAL_SENSITIVITY = {
  /** Happiness is reported 0..100; a full-pressure period costs this many points. */
  happiness: { value: 9.0, category: "MODEL_ASSUMPTION" as const, calibration: "uncalibrated" as const },
  /** Protest risk is reported 0..100; a full-pressure period adds this many points. */
  protestRisk: { value: 6.0, category: "MODEL_ASSUMPTION" as const, calibration: "uncalibrated" as const },
  source: WARI_FOOTFALL_SOURCE,
};

/**
 * Apply a civic-pressure index to happiness (0..100 points) and protest risk
 * (0..100 points). Only the sign is asserted; the magnitudes are assumptions.
 */
export function applySeasonalPressure(
  civicPressure: number,
  happinessIndex: number,
  protestRiskPct: number,
): { happinessIndex: number; protestRisk: number } {
  return {
    happinessIndex: happinessIndex - civicPressure * SEASONAL_SENSITIVITY.happiness.value,
    protestRisk: Math.min(100, protestRiskPct + civicPressure * SEASONAL_SENSITIVITY.protestRisk.value),
  };
}
