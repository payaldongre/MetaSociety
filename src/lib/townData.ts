/**
 * Real town datasets, derived from the generated Census-anchored population.
 *
 * The Data Intelligence and Dashboard pages previously rendered `src/lib/mockData.ts`
 * — invented figures with no provenance, which is exactly the criticism the
 * evaluation made. Everything here is computed from the same population the
 * Simulation Lab simulates, so a number on these pages can be traced to the
 * generator, and `FIELD_LEDGER` states which fields are measured and which are
 * modelled.
 *
 * Two series the old pages showed have **no honest source** and are not
 * reproduced: a multi-year employment trend and a cost-of-living index over
 * time. This town is a single Census-2011 snapshot; the engine has no time
 * series for it, so inventing one is not an option. Those panels were replaced
 * with cross-sectional facts the population actually supports.
 */

import { WORKING_AGE_MIN } from "@/simulation/census";
import { AGE_BANDS, INCOME_CLASSES, INCOME_CLASS_LABELS, SECTORS, WORKER_STATUSES } from "@/simulation/types";
import type { ProvenanceTag } from "@/simulation/types";
import {
  CENSUS,
  FIELD_LEDGER,
  TOWN_DISTRICT,
  TOWN_NAME,
  getPopulation,
  incomeHistogram,
  zonePopulations,
} from "@/simulation";

const SECTOR_LABELS: Record<string, string> = {
  agriculture: "Agriculture",
  manufacturing: "Manufacturing",
  services: "Services",
  pilgrimage_tourism: "Pilgrimage & tourism",
  construction: "Construction",
  trade: "Trade",
  public_admin: "Public admin",
  informal_other: "Informal / other",
};

export const SENTIMENT_LABELS = ["Negative", "Neutral", "Positive"] as const;

export interface TownFacts {
  town: string;
  district: string;
  population: number;
  households: number;
  meanHouseholdSize: number;
  wards: number;
  workingAgeShare: number;
  literacyRate: number;
  maleLiteracy: number;
  femaleLiteracy: number;
  workerShare: number;
  povertyShare: number;
}

/** Counts by age band and sex — a direct read of the generated agents. */
export function populationByAgeSex(): { group: string; male: number; female: number }[] {
  const pop = getPopulation();
  return AGE_BANDS.map((band, bandIdx) => {
    let male = 0;
    let female = 0;
    for (let i = 0; i < pop.size; i += 1) {
      if (pop.ageBand[i] !== bandIdx) continue;
      if (pop.sex[i] === 0) male += 1;
      else female += 1;
    }
    return { group: band, male, female };
  });
}

/** Worker status by age band — replaces the unsourced "employment trend". */
export function workerStatusByAge(): { group: string; nonWorker: number; main: number; marginal: number }[] {
  const pop = getPopulation();
  const nonWorkerIdx = WORKER_STATUSES.indexOf("non_worker");
  const mainIdx = WORKER_STATUSES.indexOf("main");
  const from = AGE_BANDS.indexOf("15-24");
  return AGE_BANDS.slice(from).map((band) => {
    const bandIdx = AGE_BANDS.indexOf(band);
    let nonWorker = 0;
    let main = 0;
    let marginal = 0;
    for (let i = 0; i < pop.size; i += 1) {
      if (pop.ageBand[i] !== bandIdx) continue;
      const status = pop.workerStatus[i];
      if (status === nonWorkerIdx) nonWorker += 1;
      else if (status === mainIdx) main += 1;
      else marginal += 1;
    }
    return { group: band, nonWorker, main, marginal };
  });
}

/** Household income per capita, in the same buckets the Simulation Lab reports. */
export function incomeDistribution(): { bracket: string; count: number }[] {
  return incomeHistogram(getPopulation()).map((b) => ({ bracket: b.bucket, count: b.count }));
}

/** Share of the town's workers by sector. */
export function sectorComposition(): { sector: string; share: number }[] {
  const pop = getPopulation();
  const counts = new Array(SECTORS.length).fill(0);
  let workers = 0;
  for (let i = 0; i < pop.size; i += 1) {
    if (pop.workerStatus[i] === WORKER_STATUSES.indexOf("non_worker")) continue;
    counts[pop.sector[i]] += 1;
    workers += 1;
  }
  return SECTORS.map((sector, i) => ({
    sector: SECTOR_LABELS[sector] ?? sector,
    share: workers > 0 ? Number(((counts[i] / workers) * 100).toFixed(1)) : 0,
  })).sort((a, b) => b.share - a.share);
}

/** Income-class composition of the population. */
export function incomeClassComposition(): { label: string; count: number }[] {
  const pop = getPopulation();
  const counts = new Array(INCOME_CLASSES.length).fill(0);
  for (let i = 0; i < pop.size; i += 1) counts[pop.incomeClass[i]] += 1;
  return INCOME_CLASSES.map((key, i) => ({ label: INCOME_CLASS_LABELS[key], count: counts[i] }));
}

/** Sentiment states of the population — the one social series with a real source. */
export function sentimentComposition(): { label: string; count: number }[] {
  const pop = getPopulation();
  const counts = [0, 0, 0];
  for (let i = 0; i < pop.size; i += 1) counts[pop.sentiment[i]] += 1;
  return SENTIMENT_LABELS.map((label, i) => ({ label, count: counts[i] }));
}

/** Zone populations — wards partition the town, reported after generation. */
export function zoneComposition(): { zone: string; population: number }[] {
  const byZone = zonePopulations(getPopulation());
  return [
    { zone: "North", population: byZone.north },
    { zone: "East", population: byZone.east },
    { zone: "South", population: byZone.south },
    { zone: "West", population: byZone.west },
  ];
}

export function townFacts(): TownFacts {
  const pop = getPopulation();
  const bplIdx = INCOME_CLASSES.indexOf("bpl");
  const nonWorkerIdx = WORKER_STATUSES.indexOf("non_worker");
  let literacyPool = 0;
  let literate = 0;
  let malePool = 0;
  let maleLiterate = 0;
  let femalePool = 0;
  let femaleLiterate = 0;
  let workingAge = 0;
  let workers = 0;
  let bpl = 0;
  for (let i = 0; i < pop.size; i += 1) {
    if (pop.age[i] > 6) {
      literacyPool += 1;
      literate += pop.literate[i];
      if (pop.sex[i] === 0) {
        malePool += 1;
        maleLiterate += pop.literate[i];
      } else {
        femalePool += 1;
        femaleLiterate += pop.literate[i];
      }
    }
    if (pop.age[i] >= WORKING_AGE_MIN) workingAge += 1;
    if (pop.workerStatus[i] !== nonWorkerIdx) workers += 1;
    if (pop.incomeClass[i] === bplIdx) bpl += 1;
  }
  return {
    town: TOWN_NAME,
    district: TOWN_DISTRICT,
    population: pop.size,
    households: pop.households,
    meanHouseholdSize: pop.size / pop.households,
    wards: CENSUS.wardCount,
    workingAgeShare: workingAge / pop.size,
    literacyRate: literacyPool > 0 ? literate / literacyPool : 0,
    maleLiteracy: malePool > 0 ? maleLiterate / malePool : 0,
    femaleLiteracy: femalePool > 0 ? femaleLiterate / femalePool : 0,
    workerShare: workers / pop.size,
    povertyShare: pop.size > 0 ? bpl / pop.size : 0,
  };
}

/**
 * A plain-language profile of the town, written from the numbers above by a
 * deterministic template — not by a language model. The AI Policy Advisor is
 * the only place an LLM writes prose, and it is asked for policy suggestions,
 * never for these figures.
 */
export function townProfileParagraphs(): { heading: string; body: string }[] {
  const facts = townFacts();
  const topSectors = sectorComposition().slice(0, 3);
  const zones = zoneComposition();
  const pct = (v: number) => `${(v * 100).toFixed(1)}%`;

  return [
    {
      heading: "Population",
      body: `${facts.town} (${facts.district}) is modelled as ${facts.population.toLocaleString("en-IN")} residents across ${facts.households.toLocaleString("en-IN")} households and ${facts.wards} wards, one agent per citizen. The working-age share is ${pct(facts.workingAgeShare)}. Effective literacy is ${pct(facts.literacyRate)} overall — ${pct(facts.maleLiteracy)} for men and ${pct(facts.femaleLiteracy)} for women — measured on residents aged 7 and over.`,
    },
    {
      heading: "Work and economy",
      body: `${pct(facts.workerShare)} of residents are workers, concentrated in ${topSectors.map((s) => `${s.sector} (${s.share}%)`).join(", ")}. Income and sector are modelled from the town's pilgrimage-centred economy, not measured: the Census does not record income or industry, which is why both are tagged modelled in the provenance ledger.`,
    },
    {
      heading: "Distribution and space",
      body: `Households below the poverty line are ${pct(facts.povertyShare)} of the population, and the four reporting zones partition the town as ${zones.map((z) => `${z.zone} ${z.population.toLocaleString("en-IN")}`).join(", ")}. Zone incidence is reported after a Simulation Lab run, so a policy that helps the town on average can be seen helping one zone far more than another.`,
    },
  ];
}

/** How many fields are measured vs modelled — the honesty ledger. */
export function provenanceCounts(): Record<ProvenanceTag, number> {
  const counts: Record<ProvenanceTag, number> = { census2011: 0, estimated: 0, modelled: 0, assumed: 0 };
  for (const entry of FIELD_LEDGER) counts[entry.tag] += 1;
  return counts;
}
