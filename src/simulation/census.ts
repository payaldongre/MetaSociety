/**
 * Census-anchored reference data for the flagship town, Pandharpur (Solapur
 * district, Maharashtra), plus the field-level provenance ledger and the
 * modelled assumptions the generator depends on.
 *
 * READ THIS BEFORE CITING ANY NUMBER IN THIS FILE.
 *
 * `FIELD_LEDGER` is the artifact that keeps the project defensible: it
 * separates fields that are verified against published Census 2011 figures from
 * fields that are modelled or assumed. The Simulation Lab renders this ledger
 * directly in its provenance panel, and `validatePopulation` asserts the
 * verified totals match exactly.
 *
 * OPEN ITEMS (recorded, not hidden):
 *   1. LITERACY DEFINITION. Sources differ: 76.89% vs 86.65%. These are
 *      almost certainly crude vs effective literacy (effective excludes
 *      under-7s). We use the EFFECTIVE figures below. Verify against the
 *      primary Census 2011 PDF before publication.
 *   2. WARD -> ZONE MAPPING is an assumption (contiguous ward ranges, balanced
 *      population), not sourced geography. Replace with real ward boundaries
 *      if they become available.
 *   3. POVERTY RATE and MEAN INCOME are modelled. The Indian Census does not
 *      collect income. Replace with NSSO consumption expenditure or District
 *      Census Handbook industry-of-worker tables when available.
 *   4. SECTOR COMPOSITION is modelled, informed by Pandharpur's known
 *      pilgrimage economy (Vitthal-Rukmini temple), with internal correlations
 *      enforced rather than independent sampling.
 */

import { AGE_BANDS, INCOME_CLASSES, PROVENANCE_TAGS, SECTORS, ZONES } from "./types";
import type { AgeBand, IncomeClass, ProvenanceTag, Sector } from "./types";

export const TOWN_ID = "pandharpur_in_mh";
export const TOWN_NAME = "Pandharpur";
export const TOWN_DISTRICT = "Solapur, Maharashtra";
export const CENSUS_YEAR = 2011;

/** Verified Census 2011 figures for Pandharpur Municipal Council. */
export const CENSUS = {
  totalPopulation: 98923,
  male: 50645,
  female: 48278,
  households: 20054,
  children0to6: 11151,
  sexRatio: 953,
  literacyMaleEffective: 0.8111,
  literacyFemaleEffective: 0.7245,
  /** Crude variant reported by a second source — retained for the audit note. */
  literacyCrudeReportedAlt: 0.7689,
  scShare: 0.1234,
  stShare: 0.0547,
  totalWorkers: 30855,
  maleWorkers: 25162,
  femaleWorkers: 5693,
  wards: 33,
  wardCount: 33,
} as const;

/** Derived, and asserted in validatePopulation. */
export const CENSUS_DERIVED = {
  meanHouseholdSize: CENSUS.totalPopulation / CENSUS.households, // 4.9326
  child0to6Share: CENSUS.children0to6 / CENSUS.totalPopulation, // 0.11273
  scCount: Math.round(CENSUS.scShare * CENSUS.totalPopulation), // 12207
  stCount: Math.round(CENSUS.stShare * CENSUS.totalPopulation), // 5411
  workingAgeShare: 1 - CENSUS.children0to6 / CENSUS.totalPopulation,
} as const;

/* ------------------------------------------------------------------ */
/* Modelled assumptions (documented, replaceable)                      */
/* ------------------------------------------------------------------ */

/**
 * Estimated age-band shares. Only the 0–6 bracket (11.27%) is a confirmed
 * Census figure; the remaining bands use typical urban-Maharashtra age-pyramid
 * shares. Documented here rather than buried in the generator.
 */
export const AGE_BAND_SHARES: Record<AgeBand, number> = {
  "0-6": CENSUS_DERIVED.child0to6Share, // 0.1127 — verified
  "7-14": 0.1317,
  "15-24": 0.1682,
  "25-34": 0.1594,
  "35-44": 0.1461,
  "45-54": 0.1187,
  "55-64": 0.0842,
  "65+": 0.079,
};

/** Modelled: Census does not collect income. */
export const MODELLED_POVERTY_RATE = 0.18;
export const MODELLED_MEAN_MONTHLY_INCOME_PER_EARNER = 12400;
/** Lognormal sigma of the individual income distribution (modelled). */
export const MODELLED_INCOME_SIGMA = 0.62;
/** Split of the informal/formal composition of the workforce (modelled). */
export const MODELLED_INFORMAL_SHARE = 0.78;
/** Main vs marginal worker split of the Census worker total (modelled). */
export const MODELLED_MAIN_WORKER_SHARE = 0.82;
/** Workers as a share of the working-age population, before literacy tilt. */
export const MODELLED_WORKFORCE_PARTICIPATION_TARGET = 0.455;
/** Ratio of P(worker | literate) to P(worker | not literate) (observed ~1.95). */
export const MODELLED_LITERACY_WORKER_RATIO = 1.95;

/** Modelled composition of the town's workforce. Pilgrimage economy dominant. */
export const SECTOR_COMPOSITION: Record<Sector, number> = {
  pilgrimage_tourism: 0.19,
  trade: 0.17,
  services: 0.16,
  manufacturing: 0.13,
  agriculture: 0.12,
  construction: 0.1,
  informal_other: 0.08,
  public_admin: 0.05,
};

/** Modelled income-class composition. Lower tail matches MODELLED_POVERTY_RATE. */
export const INCOME_CLASS_COMPOSITION: Record<IncomeClass, number> = {
  bpl: MODELLED_POVERTY_RATE, // 0.18
  low: 0.18,
  lower_middle: 0.22,
  middle: 0.22,
  upper_middle: 0.14,
  high: 0.06,
};

/** Modelled: mean probability of effective literacy by income class. */
export const MODELLED_LITERACY_BY_INCOME: Record<IncomeClass, number> = {
  bpl: 0.6,
  low: 0.685,
  lower_middle: 0.755,
  middle: 0.815,
  upper_middle: 0.868,
  high: 0.925,
};

/** Modelled: task exposure (automation + augmentation weight) by sector. */
export const SECTOR_TASK_EXPOSURE: Record<Sector, { automation: number; augmentation: number; automationRisk: number }> = {
  agriculture: { automation: 0.18, augmentation: 0.22, automationRisk: 0.2 },
  manufacturing: { automation: 0.44, augmentation: 0.31, automationRisk: 0.46 },
  services: { automation: 0.38, augmentation: 0.42, automationRisk: 0.35 },
  pilgrimage_tourism: { automation: 0.12, augmentation: 0.26, automationRisk: 0.15 },
  construction: { automation: 0.14, augmentation: 0.16, automationRisk: 0.16 },
  trade: { automation: 0.22, augmentation: 0.28, automationRisk: 0.24 },
  public_admin: { automation: 0.35, augmentation: 0.44, automationRisk: 0.3 },
  informal_other: { automation: 0.08, augmentation: 0.12, automationRisk: 0.1 },
};

/**
 * Modelled: effect lag in MONTHS before each policy channel reaches full
 * strength. Without differentiated lags every metric moves in lock-step and
 * the trajectory is not credible.
 */
export const CHANNEL_LAGS_MONTHS = {
  subsidyEmployment: 5,
  taxDemand: 3,
  housing: 14,
  education: 30,
  regulation: 9,
  demandPassThrough: 4,
  inflationToSentiment: 3,
  skillAdjustment: 24,
} as const;

/** Modelled: ward -> zone assignment. Balanced contiguous ranges (assumption). */
export const WARD_ZONE_MAP: Record<number, (typeof ZONES)[number]> = (() => {
  const map: Record<number, (typeof ZONES)[number]> = {};
  const bands: { zone: (typeof ZONES)[number]; from: number; to: number }[] = [
    { zone: "north", from: 1, to: 9 },
    { zone: "east", from: 10, to: 17 },
    { zone: "south", from: 18, to: 25 },
    { zone: "west", from: 26, to: 33 },
  ];
  for (const band of bands) {
    for (let w = band.from; w <= band.to; w += 1) map[w] = band.zone;
  }
  return map;
})();

/** Modelled: wards adjacent to the Vitthal-Rukmini temple corridor. */
export const PILGRIMAGE_WARDS = [4, 5, 6, 10, 11, 26, 27];

/* ------------------------------------------------------------------ */
/* Provenance ledger                                                   */
/* ------------------------------------------------------------------ */

export interface LedgerEntry {
  field: string;
  tag: ProvenanceTag;
  basis: string;
}

export const FIELD_LEDGER: LedgerEntry[] = [
  { field: "population", tag: "census2011", basis: "Total population 98,923 (M 50,645 / F 48,278)" },
  { field: "sex", tag: "census2011", basis: "Gender split matches published totals exactly" },
  { field: "households", tag: "census2011", basis: "20,054 households; mean size 4.93" },
  { field: "children_0_6", tag: "census2011", basis: "11,151 children aged 0–6 (11.27%)" },
  { field: "literate", tag: "census2011", basis: "Effective literacy M 81.11% / F 72.45% (see OPEN ITEM 1)" },
  { field: "sc_st", tag: "census2011", basis: "SC 12.34% / ST 5.47%" },
  { field: "worker_status", tag: "census2011", basis: "30,855 workers (M 25,162 / F 5,693)" },
  { field: "ward", tag: "census2011", basis: "33 wards; population evenly distributed (assumption)" },
  { field: "age_band_0_6", tag: "census2011", basis: "Verified bracket" },
  { field: "age_band_other", tag: "estimated", basis: "Urban-Maharashtra age-pyramid shares (OPEN ITEM 3)" },
  { field: "zone", tag: "estimated", basis: "Contiguous ward ranges, population-balanced (OPEN ITEM 2)" },
  { field: "income_class", tag: "modelled", basis: "Census does not collect income (OPEN ITEM 3)" },
  { field: "income", tag: "modelled", basis: "Lognormal calibrated to modelled mean; lower tail = poverty rate" },
  { field: "sector", tag: "modelled", basis: "Pilgrimage-economy estimate with enforced correlations (OPEN ITEM 4)" },
  { field: "education_level", tag: "modelled", basis: "Conditioned on literacy and income class" },
  { field: "housing_quality", tag: "modelled", basis: "Conditioned on income class" },
  { field: "health_insurance", tag: "modelled", basis: "Conditioned on income class and informality" },
  { field: "infra_access", tag: "modelled", basis: "Conditioned on income class and ward" },
  { field: "task_exposure", tag: "modelled", basis: "Sector-level task exposure mapping" },
  { field: "latent_behaviour", tag: "assumed", basis: "Behavioural priors; varied in sensitivity runs" },
];

export function ledgerTable(): LedgerEntry[] {
  return FIELD_LEDGER.map((e) => ({ ...e }));
}

export function ledgerCounts(): Record<ProvenanceTag, number> {
  const counts = Object.fromEntries(PROVENANCE_TAGS.map((t) => [t, 0])) as Record<ProvenanceTag, number>;
  for (const entry of FIELD_LEDGER) counts[entry.tag] += 1;
  return counts;
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

export function ageBandForAge(age: number): AgeBand {
  if (age <= 6) return "0-6";
  if (age <= 14) return "7-14";
  if (age <= 24) return "15-24";
  if (age <= 34) return "25-34";
  if (age <= 44) return "35-44";
  if (age <= 54) return "45-54";
  if (age <= 64) return "55-64";
  return "65+";
}

export const WORKING_AGE_MIN = 15;

export function incomeClassForMonthlyIncome(income: number): IncomeClass {
  if (income < 3200) return INCOME_CLASSES[0];
  if (income < 6500) return INCOME_CLASSES[1];
  if (income < 11000) return INCOME_CLASSES[2];
  if (income < 18000) return INCOME_CLASSES[3];
  if (income < 32000) return INCOME_CLASSES[4];
  return INCOME_CLASSES[5];
}

/** Representative monthly income per class, used to summarise household income. */
export const INCOME_CLASS_BOUNDS: Record<IncomeClass, [number, number]> = {
  bpl: [600, 3200],
  low: [3200, 6500],
  lower_middle: [6500, 11000],
  middle: [11000, 18000],
  upper_middle: [18000, 32000],
  high: [32000, 95000],
};

export const AGE_BAND_LIST = AGE_BANDS;
export const SECTOR_LIST = SECTORS;
export const ZONE_LIST = ZONES;
export const INCOME_CLASS_LIST = INCOME_CLASSES;
