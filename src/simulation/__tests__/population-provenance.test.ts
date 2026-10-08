/**
 * Population provenance linkage (spec §1, §4.5, population spec §33).
 *
 * The deterministic in-memory generator (`population.ts`) is the CANONICAL
 * representation for simulation. The repository also ships
 * `pandharpur_synthetic_population.csv` as a source/validation artifact. This
 * test LINKS the two for the Census-anchored fields and documents — in code —
 * the crosswalk limitations, so the artifact can never be silently mixed with
 * the generator.
 *
 * Reading the CSV here is a validation step, not a simulation input.
 */

import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { CENSUS, FIELD_LEDGER, GENERATOR_VERSION, NODE_REGISTRY } from "@/simulation";
import { generatePopulation, validatePopulation } from "@/simulation/population";

const CSV_PATH = path.resolve(process.cwd(), "pandharpur_synthetic_population.csv");

/** The documented CSV schema, asserted so a silent column change fails loudly. */
const EXPECTED_COLUMNS = [
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
];

function parseCsv(): { header: string[]; rows: string[][] } {
  const text = readFileSync(CSV_PATH, "utf8").trimEnd();
  const lines = text.split("\n");
  const header = lines[0].split(",");
  const rows = lines.slice(1).map((l) => l.split(","));
  return { header, rows };
}

describe("population provenance: generator is canonical, CSV is a validation artifact", () => {
  it("documents the actual BN node count so docs cannot drift silently", () => {
    // README/SIMULATION_LAB_SPEC state this count. If the registry changes,
    // this fails and the docs must be updated in the same commit.
    expect(NODE_REGISTRY.length).toBe(30);
    expect(new Set(NODE_REGISTRY.map((n) => n.id)).size).toBe(NODE_REGISTRY.length);
  });

  it("generates the canonical population and passes every validated Census total", () => {
    const pop = generatePopulation(20260101);
    expect(pop.size).toBe(CENSUS.totalPopulation);
    expect(pop.generatorVersion).toBe(GENERATOR_VERSION);
    expect(pop.manifest).toBeTruthy();
    const failed = validatePopulation(pop).filter((c) => !c.passed);
    expect(failed.map((f) => `${f.check}: ${f.observed}`)).toEqual([]);
  });

  it("agrees with the CSV artifact on every Census-anchored field", () => {
    const { header, rows } = parseCsv();
    expect(header).toEqual(EXPECTED_COLUMNS);
    expect(rows.length).toBe(CENSUS.totalPopulation);

    const gender = { M: 0, F: 0 };
    const wards = new Set<number>();
    const households = new Set<string>();
    for (const row of rows) {
      const rec = Object.fromEntries(header.map((h, i) => [h, row[i]]));
      gender[rec.gender as "M" | "F"] += 1;
      wards.add(Number(rec.ward));
      households.add(rec.household_id);
    }
    expect(gender.M).toBe(CENSUS.male);
    expect(gender.F).toBe(CENSUS.female);
    expect(households.size).toBe(CENSUS.households);
    expect(wards.size).toBe(CENSUS.wardCount);
    expect(Math.min(...wards)).toBe(1);
    expect(Math.max(...wards)).toBe(CENSUS.wardCount);
  });

  it("records the crosswalk limitation: the CSV carries MODELLED fields too, and lacks generator-only ones", () => {
    const { header } = parseCsv();

    // The CSV carries sector and income_class, which the ledger tags as modelled
    // (the Census does not collect income). They must not be read as measured.
    for (const modelledField of ["income_class", "sector"]) {
      const ledgerEntry = FIELD_LEDGER.find((e) => e.field === modelledField || e.field === modelledField.split("_")[0]);
      expect(ledgerEntry, `${modelledField} missing from the ledger`).toBeTruthy();
      expect(ledgerEntry?.tag).not.toBe("census2011");
      expect(header).toContain(modelledField);
    }

    // The generator produces fields the CSV does not carry, which is why the CSV
    // is not and cannot be the simulation input.
    for (const generatorOnly of ["income", "housing_quality", "health_insurance", "task_exposure"]) {
      expect(header).not.toContain(generatorOnly);
    }
  });
});
