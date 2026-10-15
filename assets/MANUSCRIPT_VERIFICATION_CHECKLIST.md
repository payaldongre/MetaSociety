# Manuscript Verification Checklist — `Meta_Society_IEEE_Format_Completed.docx`

**Deliverable:** `assets/Meta_Society_IEEE_Format_Completed.docx` (newly rebuilt — **not** a recovered file)
**Generator:** `assets/build_completed_paper.py` (additive; does not overwrite either existing draft)
**Verified against:** `origin/main` @ commit **`5739512`** (`git show 5739512:<path>`)
**Local base of this workspace:** `208bcbf` (older); all implementation claims below were checked against `5739512`, not the local tree.
**Date of verification:** 2026-10-15

> This document records, claim by claim, where each implementation-dependent statement in the rebuilt paper
> comes from, and whether it was verified from source, reproduced by running the engine, or left unresolved.
> Nothing in the paper was copied from the earlier draft without re-checking it.

---

## 1. Method

1. Extracted `origin/main` (`5739512`) to a scratch tree.
2. Read the authoritative docs (`README.md`, `docs/BN_STRUCTURE.md`, `docs/EXTERNAL_SHOCKS.md`, `docs/GGG.md`,
   `docs/PARAMETERS.md`, `docs/POPULATION_PROVENANCE.md`) and the engine source (`bn.ts`, `simulate.ts`,
   `aggregate.ts`, `impact.ts`, `governance.ts`, `policy-brief.ts`, `instruments.ts`, `channel-dictionary.ts`,
   `seasonality.ts`, `calibration-ledger.ts`).
3. Ran the actual engine at `5739512` (Vitest, reusing the workspace `node_modules`) to (a) count the BN nodes,
   (b) produce one real seed-ensemble run, and (c) run a draw-count sensitivity experiment.
4. Only results that were produced or pinned by source/tests were written into the manuscript.

---

## 2. Claim-by-claim verification

| # | Claim in the paper | Evidence (at `5739512`) | Status |
|---|---|---|---|
| 1 | Bayesian network has **35 nodes: 30 core + 5 exogenous shock roots** | `src/simulation/bn.ts` `DOMAINS` (35 keys, 5 `External*`), `NODE_REGISTRY`; `docs/BN_STRUCTURE.md` §8 | **VERIFIED** — counted 35 keys from source; ran `NODE_REGISTRY.length === 35` (core 30, shock 5) |
| 2 | Five shock roots named `External{Health,Economic,Climate,Infrastructure,Social}Shock`, domain `none…severe`, default `none` | `src/simulation/bn.ts`; `docs/EXTERNAL_SHOCKS.md` | **VERIFIED** |
| 3 | The `ScenarioExposure` node and the AI-scenario presets were removed | `docs/BN_STRUCTURE.md` §7; `docs/PARAMETERS.md` §6; node absent from `DOMAINS` | **VERIFIED** |
| 4 | `PolicyDuration` is a declared node with **no outgoing effect** | `docs/BN_STRUCTURE.md` §7 | **VERIFIED** (documented limitation) |
| 5 | Population reproduces Census 2011 anchors (98,923; 50,645/48,278; 20,054 HH; 11,151 aged 0–6; literacy 81.11%/72.45%; 30,855 workers; 33 wards) | `src/simulation/population.ts`, `census.ts`; `docs/POPULATION_PROVENANCE.md`; `__tests__/population-provenance.test.ts` | **VERIFIED** |
| 6 | Income/sector/education/housing are **modelled, not measured** | `census.ts` `FIELD_LEDGER`; `docs/POPULATION_PROVENANCE.md` | **VERIFIED** |
| 7 | Uncertainty ensemble = fixed internal seed set; `CONFIDENCE_ROUNDS = 12` | `src/simulation/simulate.ts` (`CONFIDENCE_ROUNDS = 12`, ensemble loop) | **VERIFIED** |
| 8 | A default run's ensemble reports **13 members** (chosen-seed trajectory + 12 rounds) | `simulate.ts` (samples initialised with the chosen-seed value, then `intervalRounds` appended) | **VERIFIED BY RUN** — engine returned `seedCount: 13`. **Corrects** the “12 seed runs” wording used in `impact.test.ts` fixtures. Paper now states 13 and explains the constant. |
| 9 | Interval is an **empirical 5th–95th percentile**, explicitly **not** a statistical confidence interval | `src/simulation/impact.ts` (~L69); `__tests__/impact.test.ts` | **VERIFIED** |
| 10 | Headline is the ensemble **median**, so the point is bracketed by the interval | `simulate.ts` (ensemble median computed after sampling) | **VERIFIED** |
| 11 | Table VI values (employment/GDP/income/inflation/happiness/protest/migration/Gini) | Produced by running `runSimulation` at `5739512` for a 24-month labour mission (₹12 cr, intensity 0.65, seed 20260101, `skipSearch`) | **REPRODUCED** — real output; not copied from any earlier draft |
| 12 | GDP growth is a **modelled band-derived proxy**, baseline 0 by construction, not a forecast | `aggregate.ts` (`SECTOR_PRODUCTIVITY`, `OUTPUT_STATE_WEIGHT`); `impact.ts` evidence text; run showed `baseline.gdpGrowthPct = 0` | **VERIFIED** |
| 13 | Protest-risk and migration intervals **span zero** (direction unresolved) | Same run | **REPRODUCED** |
| 14 | **Migration-direction reversal across draw counts** (rare “leave” band flips sign; coarse “consider/leave” band stable) | Draw-count probe: `policyResponse` at 100/400/1600/6400 draws × 3 seeds | **REPRODUCED** — sign of (policy − none) for `P(leave)` is 0, +, 0, + across draw counts; per-seed negative at 1,600 and positive at 6,400. Attributed to Monte-Carlo noise, not a policy effect. |
| 15 | GGG derives a grounded effect scale; for the labour mission ≈ **0.106**, parents DAY-NULM + MGNREGA | `ggg.ts`; `docs/GGG.md`; run output (`ggg.effectScale`, `ggg.parents`) | **VERIFIED BY RUN** |
| 16 | GGG resolution limit: below ≈0.4 the discrete policy bands saturate | `docs/GGG.md` (“resolution limit”) | **VERIFIED** (documented) |
| 17 | GGG enters as a continuous multiplier via one seam; not an output cap; not an LLM/DE/backtest | `docs/GGG.md`; `simulate.ts` `groundedPolicyBands`; `plausibility.test.ts` | **VERIFIED** |
| 18 | No calibration-ledger entry is fully calibrated (`limited`/`uncalibrated` only) | `src/simulation/calibration-ledger.ts`; `docs/GGG.md` (uncertainty & honesty) | **VERIFIED** |
| 19 | Governance registry names **seven** authorities | `src/simulation/governance.ts` `AUTHORITY_IDS` | **VERIFIED** |
| 20 | No statutory monetary ceiling recorded; ₹200,000,000 is a **model assumption**, not a legal limit | `governance.ts` (`statutoryMonetaryCeiling: null` for all; `SIMULATION_SAFETY_LIMIT` category `MODEL_ASSUMPTION`); `policy-brief.ts` | **VERIFIED** |
| 21 | Brief feasibility gate is enforced **in the engine** (`PolicyFeasibilityError`) | `policy-brief.ts`; `simulate.ts` | **VERIFIED** |
| 22 | **8 implemented** / **5 declared** channels | `src/simulation/channel-dictionary.ts` (`status`) | **VERIFIED** |
| 23 | Multi-channel policy composes only one family; order-invariant; engine emits a warning | `instruments.ts` (`CHANNEL_PRECEDENCE`); `docs/BN_STRUCTURE.md` §8 | **VERIFIED** |
| 24 | Accounting identities: asserted each period **only for the full-population path**; re-checked on the treated final level, throwing on failure; seasonal adjustment applied *after* level computation | `simulate.ts` (`assertIdentities` when `agents === null`, ~L627; `checkIdentities(...finalLevel)`, ~L1322; `adjustSeasonal`); `aggregate.ts` | **VERIFIED** |
| 25 | Shocks intervene via `do(...)` on an exogenous node; the **same schedule** is replayed for baseline and policy; Poisson generates *timing* only | `shocks.ts`; `docs/EXTERNAL_SHOCKS.md` | **VERIFIED** |
| 26 | Default shock rates are **scenario assumptions**, not sourced hazard rates | `docs/EXTERNAL_SHOCKS.md` | **VERIFIED** |
| 27 | Wari seasonal layer: pilgrims never added to residents; footfall anchored to ~32 lakh/3 days (2026), ~27–28 lakh Ekadashi (2025) | `seasonality.ts` (`WARI_FOOTFALL_SOURCE` with URL) | **VERIFIED** (sourced) |
| 28 | A pilgrimage policy carries its seasonal effect and **no generic income effect** (<5% mean-income move) | `plausibility.test.ts` | **VERIFIED** |
| 29 | DE + NSGA-II search with an equal-budget random-search control; reduced-agent search tier is the only approximation | `de.ts`, `simulate.ts`; `README.md` | **VERIFIED** |
| 30 | Policy search genes/ranges (Table V) | `docs/PARAMETERS.md` §7; `simulate.ts` `DE_BOUNDS` | **VERIFIED** |
| 31 | AI Policy Advisor: 3-stage LangGraph pipeline, FastAPI, server-side key | `backend/`; `README.md` | **VERIFIED** |
| 32 | Advisor is **optional**; engine/UI run without it | `README.md` | **VERIFIED** |
| 33 | Web Worker path runs the same `runSimulation` | `worker.ts`, `worker-client.ts` | **VERIFIED** (present; Table I wording) |
| 34 | Persistence: browser store verified; Supabase mirror wired but not exercised end-to-end | `README.md`; `docs` | **VERIFIED** (documented caveat) |
| 35 | References [1]–[13] | Retained from the existing template's书目; all 13 cited in text | **VERIFIED** (numbered, in-text markers present) |

---

## 3. Corrections made to the earlier draft’s framing

| Earlier framing | Correction in this rebuilt paper | Basis |
|---|---|---|
| “29-node Bayesian network” | **35 nodes (30 core + 5 exogenous shock roots)** | `bn.ts` `DOMAINS` |
| “12 seed runs … empirical interval” | **13 ensemble members** for a default run (chosen seed + `CONFIDENCE_ROUNDS` 12); count reported as the actual ensemble size | `simulate.ts`; run output |
| No shock layer described | **External-shock stress test** section added (5 roots, `do()`, shared schedule, Poisson timing) | `shocks.ts`; `docs/EXTERNAL_SHOCKS.md` |
| No historical-grounding stage | **GGG** section added (matching, inheritance, grounded effect scale, resolution limit) | `ggg.ts`; `docs/GGG.md` |
| Multi-channel policies implied to compose | Stated as a **limitation**: one family composes; engine warns | `instruments.ts`; `docs/BN_STRUCTURE.md` §8 |
| Verification section without sensitivity | **Draw-count sensitivity** added, including the migration-direction reversal | Probe at `5739512` |

---

## 4. Unresolved issues / outstanding checks

1. **Visual layout not verified.** No reliable DOCX→PDF converter is available in this environment
   (`libreoffice`/`soffice`/`pandoc` all absent; `python-docx` not installed and not required by the build).
   The document was therefore verified structurally (ZIP integrity, well-formed XML, style references,
   section numbering, reference list, embedded figure) but **not** rendered visually. Page/word-wrap and
   figure placement remain outstanding until the file is opened in Word / LibreOffice.
2. **Package name collision.** Opening the file may prompt Word to show the “field”/package notice because the
   template carried a document-title property; not a corruption (ZIP test passes). Cosmetic.
3. **The prior session’s exact sensitivity numbers are unknown.** The “reported migration-direction reversals”
   referenced by the brief were **not recoverable**; the numbers in Table VII are our own reproduction and may
   differ from the earlier attempt’s.
4. **`seedCount = 13` vs docs/tests saying 12.** The engine is authoritative (13). The docs/tests are not edited
   here (no source changes); this is flagged for a future documentation fix.
5. **No external validation / calibration.** Unchanged and correctly stated as a limitation; magnitudes remain
   uncalibrated.

---

## 5. Artefact facts

| Property | Value |
|---|---|
| Path | `assets/Meta_Society_IEEE_Format_Completed.docx` |
| Size | **272,696 bytes** |
| SHA-256 | `6020437ec49f506a2339c22a5f4c8bf4cf2dc573b9753bf7408ab30a3abfac4b` |
| ZIP integrity | `testzip()` → clean; 24 members |
| `document.xml` | well-formed (parsed OK) |
| Styles | all referenced styles defined in `styles.xml` |
| Sections | I–X + REFERENCES, sequential |
| Tables | 7 (I–VII) |
| Figure | reused template image, `rId14` |
| Words / paragraphs | ~8,169 words / 293 paragraphs |
| Generator | `assets/build_completed_paper.py` (run: `python3 assets/build_completed_paper.py`) |

**This is a newly rebuilt paper, not the recovered artefact from the inaccessible session.**
