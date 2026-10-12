/**
 * Population-source provenance tests (spec §1, §4.5, §32, §33).
 *
 * The repository has two population representations: the canonical in-memory
 * generator and the retained external CSV. These tests validate the CSV against
 * the SAME Census anchors and assert that the crosswalk limitations are recorded
 * — so nobody can silently swap one for the other.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  CSV_FIELD_CROSSWALK,
  CSV_KNOWN_LIMITATIONS,
  POPULATION_CSV_SOURCE,
  POPULATION_GENERATOR_SOURCE,
  populationSourceSummary,
} from "@/simulation";
import { CENSUS } from "@/simulation/census";

const CSV_PATH = path.resolve(process.cwd(), "pandharpur_synthetic_population.csv");

function parseCsv() {
  const text = readFileSync(CSV_PATH, "utf8");
  const lines = text.split(/\r?\n/);
  const header = lines[0].split(",");
  const rows: string[][] = [];
  for (let i = 1; i < lines.length; i += 1) {
    if (!lines[i]) continue;
    rows.push(lines[i].split(","));
  }
  return { header, rows };
}

describe("CSV is validated as a source artifact against the Census anchors", () => {
  const { header, rows } = parseCsv();

  it("has the declared schema and 98,923 data rows", () => {
    expect(header).toEqual([
      "citizen_id",
      "household_id",
      "ward",
      "gender",
      "age_band",
      "caste_category",
      "literate",
      "is_worker",
      "sector",
      "income_class",
    ]);
    expect(rows.length).toBe(CENSUS.totalPopulation);
    expect(rows.length).toBe(POPULATION_CSV_SOURCE.rows);
  });

  it("matches the Census sex split, households, workers and ward count exactly", () => {
    let male = 0;
    let female = 0;
    let workers = 0;
    let maleWorkers = 0;
    let femaleWorkers = 0;
    const households = new Set<string>();
    const wards = new Set<number>();
    for (const r of rows) {
      const gender = r[3];
      const isWorker = r[7] === "True";
      if (gender === "M") {
        male += 1;
        if (isWorker) maleWorkers += 1;
      } else if (gender === "F") {
        female += 1;
        if (isWorker) femaleWorkers += 1;
      }
      if (isWorker) workers += 1;
      households.add(r[1]);
      wards.add(Number(r[2]));
    }
    expect(male).toBe(CENSUS.male);
    expect(female).toBe(CENSUS.female);
    expect(households.size).toBe(CENSUS.households);
    expect(workers).toBe(CENSUS.totalWorkers);
    expect(maleWorkers).toBe(CENSUS.maleWorkers);
    expect(femaleWorkers).toBe(CENSUS.femaleWorkers);
    expect(wards.size).toBe(CENSUS.wardCount);
  });
});

describe("the CSV is an external artifact, not the engine population", () => {
  it("marks the generator canonical and the CSV non-canonical", () => {
    expect(POPULATION_GENERATOR_SOURCE.canonical).toBe(true);
    expect(POPULATION_GENERATOR_SOURCE.feedsEngine).toBe(true);
    expect(POPULATION_CSV_SOURCE.canonical).toBe(false);
    expect(POPULATION_CSV_SOURCE.feedsEngine).toBe(false);
  });

  it("states the relationship explicitly", () => {
    const summary = populationSourceSummary();
    expect(summary).toMatch(/NOT loaded as the engine population|not loaded as the engine population/i);
  });
});

describe("schema/crosswalk limitations are recorded, not papered over", () => {
  it("flags the vocabulary mismatches that make the CSV non-substitutable", () => {
    const byField = Object.fromEntries(CSV_FIELD_CROSSWALK.map((c) => [c.csv, c]));
    expect(byField.age_band.status).toBe("lossy");
    expect(byField.sector.status).toBe("lossy");
    expect(byField.income_class.status).toBe("absent"); // no bpl class in the CSV
    expect(byField.is_worker.status).toBe("lossy"); // no main/marginal split
    expect(byField.gender.status).toBe("exact");
    expect(byField.ward.status).toBe("exact");
  });

  it("never claims every CSV field is Census-measured", () => {
    for (const field of ["income_class", "sector"]) {
      const entry = CSV_FIELD_CROSSWALK.find((c) => c.csv === field);
      expect(entry?.tag).toBe("modelled");
    }
    expect(CSV_KNOWN_LIMITATIONS.join(" ")).toMatch(/modelled/i);
    expect(CSV_KNOWN_LIMITATIONS.join(" ")).toMatch(/vocabulary/i);
  });

  it("documents the CSV's SC/ST sampling variance against the Census anchors", () => {
    const { rows } = parseCsv();
    let sc = 0;
    let st = 0;
    for (const r of rows) {
      if (r[5] === "SC") sc += 1;
      if (r[5] === "ST") st += 1;
    }
    const scShare = sc / rows.length;
    const stShare = st / rows.length;
    // Close, but not identical to the Census anchors (the CSV was generated).
    expect(Math.abs(scShare - CENSUS.scShare)).toBeLessThan(0.005);
    expect(Math.abs(stShare - CENSUS.stShare)).toBeLessThan(0.005);
    expect(CSV_KNOWN_LIMITATIONS.join(" ")).toMatch(/SC\/ST|12\.31|5\.61/);
  });
});
