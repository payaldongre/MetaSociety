# GGG — historical-policy inheritance for Pandharpur

GGG is the Simulation Lab's historical-inheritance mechanism. It transfers
**characteristics** from real predecessor policies into a proposed Pandharpur
policy, adapts them to the town, and grounds the strength of the modelled effect
— before the causal simulation runs.

The expansion of the acronym is not confirmed, so this document does not invent
one. GGG is used as a name for the mechanism described here.

## What GGG is

```
proposed policy
      ↓  policy genome
historical policy matching
      ↓  comparable predecessors ("parents")
GGG inheritance
      ↓  inherited traits, conservatively aggregated
Pandharpur context adaptation
      ↓
evidence-informed policy characteristics + a grounded effect scale
      ↓
the existing Bayesian causal simulation (bn.ts, simulate.ts)
      ↓
baseline vs proposed, uncertainty, GGG lineage and evidence
```

GGG answers one question that the model's other components do not:

> Which characteristics of this proposed policy can be inherited from policies
> that have actually existed, and how should they be adapted to Pandharpur?

## What GGG is **not**

- **Not an LLM feature.** There is no chatbot, no prompt, no generation of
  history, and no generated number. GGG is static, sourced data
  (`historical-policies.ts`) plus deterministic arithmetic (`ggg.ts`).
- **Not Differential Evolution or NSGA-II.** Those search for the *best*
  candidate according to the model. GGG grounds the *characteristics* of a
  candidate. They compose: GGG runs first and seeds/informs the search.
- **Not generic genetic algorithms.** There is no evolutionary selection over
  policies inside GGG; inheritance is a deterministic, weighted transfer of
  historical characteristics.
- **Not backtesting.** Backtesting (`backtest.ts`) compares a prediction with a
  documented past outcome. GGG transfers characteristics *into* a new policy.
- **Not a lookup table of outcomes.** No historical outcome is ever reported as a
  simulation output. GGG produces traits and an effect *scale*; the causal
  network computes every number.
- **Not a substitute for the causal model.** GGG adapts inherited characteristics;
  it never overrides the Bayesian network, the accounting identities, governance,
  feasibility or the policy brief.

## Historical policy parents

The registry (`src/simulation/historical-policies.ts`) is deliberately small and
high-quality: programmes whose **mechanism** maps onto a channel the engine
already models.

| Predecessor | Channel | Scale | Evidence |
| --- | --- | --- | --- |
| MGNREGA (2005) | `LABOR_MARKET` | national | moderate (direction) |
| DAY-NULM (2013) | `LABOR_MARKET` | national | limited |
| PM SVANidhi (2020) | `FINANCIAL_INCLUSION` | national | limited |
| PMAY-U | `HOUSING` | national | limited |
| PM-JAY (2018) | `HEALTHCARE_ACCESS` | national | limited |
| PM POSHAN (2021) | `EDUCATION_SKILL` | national | limited |
| PM-KISAN (2019) | `INCOME_SUPPORT` | national | limited |
| Mukhyamantri Majhi Ladki Bahin Yojana (2024) | `INCOME_SUPPORT` | state | limited |
| Pandharpur pilgrimage corridor (2026) | `INFRASTRUCTURE` | state | moderate, **contested** |
| Shaktipeeth Expressway (2026) | `INFRASTRUCTURE` | state | moderate, **contested** |
| Wari toll exemption | `PILGRIMAGE_FACILITIES` | state | moderate |

Every entry records its authority, jurisdiction, implementation period,
mechanism, target population, context, seasonality, scale, delivery route, the
Bayesian-network nodes its pathway plausibly touches, its documented outcomes
(with source and fact category), its side effects, an evidence strength, a
comparability note and an uncertainty note.

**No effect size is invented.** Outcomes carry a magnitude only when a source
reports one (for example, the Wari toll waiver's direct effect is ₹0 paid in the
window, and the 2026 Wari footfall is ~32 lakh visits over three days, both
sourced). Where no evaluated magnitude exists, only the *direction* is recorded.
The registry is not survivorship-biased: contested predecessors (the corridor,
the expressway) are present with their documented opposition.

## Parent matching

Matching is a transparent, deterministic weighted similarity over eight
dimensions (`SIMILARITY_WEIGHTS` in `ggg.ts`), which sum to 1:

| Dimension | Weight | Meaning |
| --- | --- | --- |
| mechanism | 0.24 | Jaccard overlap of mechanism tags |
| channel | 0.22 | exact engine-channel match |
| causal nodes | 0.18 | Jaccard overlap of Bayesian-network nodes |
| target population | 0.12 | Jaccard overlap of target traits |
| context | 0.08 | urban / rural / mixed match |
| scale | 0.06 | administrative-level proximity |
| duration | 0.06 | duration proximity (neutral when undocumented) |
| seasonality | 0.04 | seasonal / non-seasonal match |

Mechanism and channel carry the most weight because they decide whether two
policies share a **causal path at all** — the property inheritance depends on. A
parent must reach `MIN_PARENT_SCORE` (0.34) **and** share the channel or show real
mechanism/target/pathway overlap. A housing policy therefore does not inherit
MGNREGA's employment effect merely because both are government programmes.

Each selected parent comes with a plain-language reason and a machine-readable
breakdown, so the system can always explain *why* a parent was chosen. Matching
is reproducible for the same input.

## Inheritance

`inheritTraits` aggregates parent support conservatively. A trait's confidence is
the similarity-weighted share of parents that carry it; a trait the child did not
already carry needs stronger support (≥0.45) to be added than one it did (≥0.2),
so inheritance cannot flood a genome with weakly-attested characteristics. No
extreme single parent can dominate.

## Pandharpur adaptation

GGG adapts inherited characteristics to Pandharpur's actual context, stated
dimension by dimension: resident population (98,923) versus the temporary Wari
load (~32 lakh visits over three days — never added to the resident population),
local governance (the Municipal Council, the district administration, the
Pandharpur Development Authority), the policy's own budget and duration, and the
local infrastructure constraint. A national programme's *mechanism* transfers;
its *scale* does not.

## The grounded effect scale (how GGG enters the computation)

GGG derives an effect scale for the run:

```
effectScale = clamp( comparability × evidenceFactor × scaleFactor , 0.1 , 1 )
```

- **comparability** — the best parent's similarity score (or a documented
  `NO_PARENT_COMPARABILITY` of 0.35 when nothing matches);
- **evidenceFactor** — from the strongest parent direction evidence
  (high 1.0 / moderate 0.8 / limited 0.55 / uncalibrated 0.4);
- **scaleFactor** = `1 / (1 + Δlevels)` — the number of administrative levels by
  which the widest predecessor exceeds this local application.

Every factor is a stated model assumption, listed in
`grounded.rationale`, together with the explicit note that **no historical
outcome magnitude is copied**. The engine folds `effectScale` into the policy
intensity and budget bands the Bayesian network reads, and into the per-agent
direct effects, so a small local application of a larger mechanism cannot produce
the larger mechanism's effect. The applied intensity *reported to the UI* is the
policy's own, so the grounding is visible as a separate labelled input rather
than hidden inside a number.

This is a structural grounding of a causal parameter — **not** an output cap.
There is no `if (gdp > X) gdp = X` anywhere.

### The exact seam, and its stated resolution limit

The scale reaches the network through **one** function,
`groundedPolicyBands(policy, appliedIntensity, effectScale)` in
`src/simulation/simulate.ts` (the direct engine and the Web Worker both call
`runSimulation`, so they cannot diverge). It returns the three bands the network
reads:

- `intensityBand` = band(`appliedIntensity × effectScale`, low/medium at 0.4/0.72)
- `budgetBand`   = band(`budget/₹20cr × effectScale`, low/medium at 0.25/0.6)
- `durationBand` = short / medium / long from the policy's own duration

The last one is deliberately **not** grounded away: duration is the policy's own
design input.

**Resolution limit (a limitation, not a calibrated finding).** The network's
policy dimensions are discrete (low/medium/high), so once the grounded value
falls below the "medium" cut-off the band saturates. For a grounded effect scale
below roughly 0.4 *every* local policy maps onto the same "low/low" policy state,
and neither its own intensity nor its budget changes that state. The grounding
therefore bounds the modelled effect conservatively but does **not** resolve
differences *within* the weak-grounding regime. Correcting that would require a
higher-resolution (or continuous) policy dimension in the network; it is left
explicitly unfixed here rather than tuned arbitrarily, and it is uncalibrated.

## GGG lineage

Every run retains the full chain:

```
historical evidence IDs → parent policy IDs → inherited traits
   → Pandharpur adaptation → grounded characteristics
   → policy genome → simulation run
```

It is carried on `SimulationResult.ggg.lineage` and shown in the Lab's
"Historical policy inheritance (GGG)" panel, with disclosure sections for the
evidence, the inheritance and the lineage.

## GGG and the optimiser

GGG does not replace Differential Evolution or NSGA-II. When the search runs, GGG
adds one historically grounded seed (at the grounded effect scale) to the pool,
alongside the lineage's own history. Governance, feasibility, the policy brief,
the causal simulation and the accounting identities are unchanged and still
apply.

## Uncertainty and honesty

GGG separates two things the UI must never conflate:

- **direction evidence** — how well-supported the sign of a relationship is;
- **magnitude calibration** — how well-calibrated the *size* is. GGG certifies a
  magnitude only when a parent carries a directly observed number on a comparable
  engine metric; otherwise it stays `uncalibrated`, and the run says so.

Seed-ensemble intervals remain **empirical seed-run intervals**, never
statistical confidence intervals, and the number of seed runs is always named.
GGG carries no claim of predictive accuracy.

## Limitations

- The registry is small by design; adding a predecessor is a curated, sourced edit.
- Similarity weights are a documented modelling choice, not a fitted model.
- The effect-scale formula is a stated model assumption; its components are
  inspectable and its floor is explicit, but it is not calibrated against an
  evaluated programme.
- Where a historical programme's mechanism is not yet a wired engine channel
  (e.g. `FINANCIAL_INCLUSION`), GGG grounds its characteristics but the engine
  applies no causal effect and says so.
