# Population provenance and the CSV artifact

## The canonical representation

For simulation, the canonical citizen population is the **deterministic in-memory
generator** in `src/simulation/population.ts` (`generatePopulation`). Every run
produces one agent per real resident of Pandharpur from published Census 2011
totals, is reproducible for a given seed, and exposes a `manifest` that hashes its
generation inputs. The Simulation Lab always simulates this generator; it never
loads a CSV.

This choice is deliberate and is recorded in `SIMULATION_LAB_SPEC.md` §182: there
is **no 98,923-row artifact to drift from the code**, and `validatePopulation`
asserts the verified Census totals on every generation.

## The CSV artifact

`pandharpur_synthetic_population.csv` is retained as a **source/validation
artifact**, not as a simulation input. It is linked to the generator and to the
Census totals by `src/simulation/__tests__/population-provenance.test.ts`, which
asserts that the artifact agrees with the Census-anchored fields:

| Field | CSV value | Census 2011 | Status |
| --- | --- | --- | --- |
| Population (`citizen_id` rows) | 98,923 | 98,923 | matches |
| Male / female | 50,645 / 48,278 | 50,645 / 48,278 | matches |
| Households (`household_id`, distinct) | 20,054 | 20,054 | matches |
| Wards (`ward`, distinct) | 1–33 | 33 wards | matches |

The test fails loudly if the CSV schema changes, so the linkage cannot rot
silently.

## Crosswalk limitations (read this before citing CSV columns)

The CSV schema is
`citizen_id, household_id, ward, gender, age_band, caste_category, literate,
is_worker, sector, income_class`.

- **Census-anchored columns** for the fields above are `population`, `gender`,
  `households` and `ward`. `literate` and `is_worker` are anchored to published
  totals (see `FIELD_LEDGER`).
- **`sector` and `income_class` are MODELLED, not measured.** The Indian Census
  does not collect income; `FIELD_LEDGER` tags both as `modelled`. They must never
  be presented as observed data, whichever representation is used.
- The CSV does **not** carry the generator's richer modelled fields (`income`,
  `housing_quality`, `health_insurance`, `task_exposure`, latent behavioural
  parameters). It therefore cannot be substituted for the generator without
  losing those fields.
- `age_band` in the CSV is a band label; the generator additionally stores exact
  integer ages, and only the 0–6 bracket is a verified Census figure.

## Rule

Do not hand-edit the CSV to make numbers match, and do not mix CSV rows with
generated agents in one simulation. If a field's basis is unclear, consult
`FIELD_LEDGER` in `src/simulation/census.ts`, which is the single source of truth
for what is observed, estimated, modelled or assumed.
