/**
 * Population-source provenance (spec §1, §4.5, §32, §33).
 *
 * There are TWO population representations in this repository:
 *
 *   1. The deterministic IN-MEMORY GENERATOR (`population.ts`), which is the
 *      canonical source the Simulation Lab runs on. It allocates one agent per
 *      real citizen and hits every published Census 2011 total exactly.
 *   2. The shipped CSV `pandharpur_synthetic_population.csv`, a validated
 *      EXTERNAL source artifact from the project's data phase, retained (not
 *      deleted) because it is evidence for the Census anchors.
 *
 * They are NOT the same object and must never be silently mixed. The CSV's
 * vocabularies differ from the engine's in ways that materially change the
 * meaning of a field (see `CSV_FIELD_CROSSWALK`): the CSV has no `bpl` income
 * class, uses six age bands with different cut points, names sectors the engine
 * does not, and records only a yes/no worker flag. Loading the CSV as if it were
 * the engine population would therefore not be a reconciliation — it would be a
 * silent substitution.
 *
 * This module records that relationship explicitly so the distinction is
 * enforced in code and by a test, rather than living only in prose.
 */

import type { ProvenanceTag } from "./types";

export interface PopulationSource {
  id: string;
  kind: "generator" | "external_artifact";
  /** True for the representation the engine actually simulates. */
  canonical: boolean;
  path?: string;
  /** Data rows, excluding the header. */
  rows?: number;
  description: string;
  /** Whether this representation can feed `runSimulation` directly. */
  feedsEngine: boolean;
}

/** The canonical representation: generated in memory, asserted against Census. */
export const POPULATION_GENERATOR_SOURCE: PopulationSource = {
  id: "in_memory_generator_v1",
  kind: "generator",
  canonical: true,
  rows: 98923,
  description:
    "Deterministic in-memory generator (src/simulation/population.ts). One agent per real resident, " +
    "allocated by largest-remainder so every published Census 2011 total is met exactly. " +
    "Its manifest hashes the generation inputs, so a run can be traced to the exact population.",
  feedsEngine: true,
};

/** The retained external artifact. NOT loaded by the engine. */
export const POPULATION_CSV_SOURCE: PopulationSource = {
  id: "pandharpur_synthetic_population_csv",
  kind: "external_artifact",
  canonical: false,
  path: "pandharpur_synthetic_population.csv",
  rows: 98923,
  description:
    "The project's citizen-level CSV from the data phase. Validated against the same Census anchors " +
    "(population, sex split, households, workers, wards). Retained as evidence for those anchors and " +
    "as an auditable external artifact — never loaded as the engine population.",
  feedsEngine: false,
};

export const POPULATION_SOURCES: PopulationSource[] = [POPULATION_GENERATOR_SOURCE, POPULATION_CSV_SOURCE];

/** The engine field a CSV column corresponds to, and how faithfully. */
export type CrosswalkStatus =
  /** Same meaning and vocabulary. */
  | "exact"
  /** Same meaning, different encoding (e.g. True/False vs 0/1). */
  | "encoded"
  /** Same intent, but the vocabulary differs and a lossy crosswalk is required. */
  | "lossy"
  /** The engine has no corresponding vocabulary. */
  | "absent";

export interface CsvFieldCrosswalk {
  csv: string;
  engine: string;
  status: CrosswalkStatus;
  tag: ProvenanceTag;
  note: string;
}

/**
 * Field-by-field relationship between the CSV and the engine population. Any
 * `lossy` or `absent` row is a reason the CSV cannot be substituted for the
 * generator without changing the model's meaning.
 */
export const CSV_FIELD_CROSSWALK: CsvFieldCrosswalk[] = [
  { csv: "citizen_id", engine: "(implicit agent index)", status: "exact", tag: "census2011", note: "Row identity only; not a modelled field." },
  { csv: "household_id", engine: "household (Uint32Array)", status: "exact", tag: "census2011", note: "20,054 households in both representations." },
  { csv: "ward", engine: "ward (Uint8Array)", status: "exact", tag: "census2011", note: "Wards 1–33 in both." },
  { csv: "gender", engine: "sex (M/F)", status: "exact", tag: "census2011", note: "50,645 M / 48,278 F matches the Census totals exactly." },
  { csv: "age_band", engine: "ageBand (8 bands)", status: "lossy", tag: "estimated", note: "CSV uses 6 bands (0-6, 7-14, 15-29, 30-44, 45-59, 60+) with different cut points from the engine's 8; a crosswalk cannot recover the engine bands without a modelled split." },
  { csv: "caste_category", engine: "scSt (0/1/2)", status: "lossy", tag: "census2011", note: "CSV groups General/OBC together; SC/ST shares are close to but not identical with the Census (SC 12.31% vs 12.34%, ST 5.61% vs 5.47%)." },
  { csv: "literate", engine: "literate (0/1)", status: "encoded", tag: "census2011", note: "True/False mapped to 1/0; effective-literacy definition matches." },
  { csv: "is_worker", engine: "workerStatus (non_worker/main/marginal)", status: "lossy", tag: "census2011", note: "CSV records only worker yes/no; the main/marginal split is a modelled layer the CSV does not carry." },
  { csv: "sector", engine: "sector (8 engine sectors)", status: "lossy", tag: "modelled", note: "CSV names (agriculture, government_services, informal_labour, pilgrimage_hospitality, retail_trade, small_industry) are not the engine's sector vocabulary; only populated for workers. A lossy rename is required." },
  { csv: "income_class", engine: "incomeClass (6 classes, incl. bpl)", status: "absent", tag: "modelled", note: "CSV has only 4 classes (low, lower_middle, upper_middle, high) with NO bpl class; treating the CSV 'low' as the engine 'bpl' would be a modelling decision, not a measurement. Income is modelled in both representations." },
];

/** Known reasons the CSV cannot be a drop-in for the engine population. */
export const CSV_KNOWN_LIMITATIONS: string[] = [
  "The CSV is a source artifact, not the engine population: the engine runs on the in-memory generator. Loading the CSV silently is not supported.",
  "Vocabulary mismatch: the CSV's age bands, sector names and income classes are not the engine's. Any crosswalk is lossy and must be explicit.",
  "No bpl class in the CSV income_class column: the engine's modelled poverty tail has no direct CSV counterpart.",
  "Census-measured in the CSV: population, sex split, households, integer worker counts, ward count and (effective) literacy. Modelled in the CSV: income_class, sector, and the main/marginal worker split.",
  "The CSV's SC/ST shares (12.31% / 5.61%) differ from the Census anchors (12.34% / 5.47%) because the CSV was generated, not measured; the engine generator reproduces the Census anchors exactly.",
];

/** A one-line relationship the UI can show without re-deriving it. */
export function populationSourceSummary(): string {
  return (
    `${POPULATION_GENERATOR_SOURCE.description} ` +
    `The external artifact ${POPULATION_CSV_SOURCE.path} is retained and validated as evidence for the Census anchors, ` +
    `but is NOT loaded as the engine population (its vocabularies differ — see the crosswalk).`
  );
}
