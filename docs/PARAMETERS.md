# Policy parameters

_Every knob the Simulation Lab exposes, its range, units, default, and the basis
for it._

> Compiled from `src/simulation/simulate.ts` (`DE_BOUNDS`, `decodeVector`,
> `REFERENCE_BUDGET`, `MONTHS_PER_PERIOD`, `SCENARIO_PRESETS`, `policyLogShift`,
> `rampFor`), `src/simulation/census.ts` (`CHANNEL_LAGS_MONTHS`) and the
> controls in `src/pages/SimulationLab.tsx`.

**A parameter is only "sourced" if a published figure or an official scheme
benchmark is cited. Everything else is explicitly an ASSUMPTION.** None of the
policy magnitudes below are currently calibrated against an evaluated real
programme; they encode direction and rough relative strength only.

## 1. Core policy vector

| Parameter | Range | Units | Default (Lab) | Basis |
| --- | --- | --- | --- | --- |
| `intensity` | 0.05 – 1.00 (DE); 5–100% step 5 (UI) | share of instrument's maximum strength | **0.65** | **ASSUMPTION** — no external scale. |
| `budget` | ₹2,000,000 – ₹200,000,000 (DE); 1–20 crore step 0.5 (UI) | INR total programme cost | **₹12,00,00,000** (12 crore) | **ASSUMPTION** — `REFERENCE_BUDGET` is a design envelope, not a scheme figure. |
| `durationMonths` | 3 – 60, rounded to a multiple of 3 | months | **24** | **ASSUMPTION** — chosen to span short/medium/long bands. |
| `allocation.housing` | 0.02 – 1.00 (DE); 5–90% (UI) | share of the three-way split | **30% raw → 30.0% normalised** for 30/40/30 | **ASSUMPTION** |
| `allocation.education` | 0.02 – 1.00 (DE); 5–90% (UI) | share of the three-way split | **40% raw → 40.0% normalised** | **ASSUMPTION** |
| `allocation.employment` | 0.02 – 1.00 (DE); 5–90% (UI) | share of the three-way split | **30% raw → 30.0% normalised** | **ASSUMPTION** |

> **Allocation semantics (important).** The three allocation sliders are
> **normalised to sum to 1** in `decodeVector` and in the page
> (`allocTotal = h + e + w; share = value / allocTotal`). They are *not* shares
> of the total budget, and there is **no fourth "unallocated" channel** — the
> budget is always fully split across housing / education / employment. If the
> sliders read 15 / 15 / 20 (sum 50), the effective shares are 30% / 30% / 40%.
> The UI now displays the normalised share next to each slider to make this
> explicit.

## 2. Budget mechanics

| Parameter | Value | Basis |
| --- | --- | --- |
| Reference budget envelope (`REFERENCE_BUDGET`) | ₹200,000,000 | **ASSUMPTION** |
| Period length (`MONTHS_PER_PERIOD`) | 3 months | **ASSUMPTION** |
| Per-period budget | `budget / durationMonths × 3`, capped by what remains | accounting identity |
| Budget bands (`budgetBand`) | low < 0.25, medium < 0.6, high ≥ 0.6 of reference | **ASSUMPTION** |
| Intensity bands (`intensityBand`) | low < 0.40, medium < 0.72, high ≥ 0.72 (after ramp × budget scale) | **ASSUMPTION** |
| Duration bands | short ≤ 12, medium ≤ 36, long > 36 months | **ASSUMPTION** |

## 3. Channel lags (`CHANNEL_LAGS_MONTHS`)

Months before each channel reaches full strength, applied by `rampFor` as
`intensity × min(1, (month + 0.5) / lag)`.

| Channel | Lag (months) | Basis |
| --- | --- | --- |
| `taxDemand` | 3 | **ASSUMPTION** |
| `subsidyEmployment` | 5 | **ASSUMPTION** |
| `regulation` | 9 | **ASSUMPTION** |
| `housing` | 14 | **ASSUMPTION** |
| `demandPassThrough` | 4 | **ASSUMPTION** (used to smooth demand → inflation) |
| `education` | 30 | **ASSUMPTION** |
| `inflationToSentiment` | 3 | **ASSUMPTION** |
| `skillAdjustment` | 24 | **ASSUMPTION** |

## 4. Instrument channels (`policyLogShift`)

Additive log-weight shifts applied on top of the counted base table, scaled by
`s = intensityScale × budgetScale`. Positive values favour the *listed* child
state. All magnitudes are **ASSUMPTIONS**; only the *sign* is asserted by tests.

### `subsidy`

| Node | Shift (low→high child states) |
| --- | --- |
| SectorDemand | `[+0.4s, 0, +1.0s]` (growing promised) |
| IncomeClass | `[+0.5s, +0.25s, −0.1s, −0.25s, −0.3s, −0.3s]` (redistributive down) |
| EmploymentStatus | `[−1.0s, −0.1s, +0.7s]` (toward formal) |
| SpendingCapacity | `[−0.7s, 0, +0.6s]` |
| Inflation | `[−0.4s, 0, +0.75s]` |
| PublicSentiment | `[−0.55s, 0, +0.65s]` |
| ProtestRiskBand | `[+0.5s, 0, −0.45s]` |

### `labor`

| Node | Shift |
| --- | --- |
| SectorDemand | `[+0.3s, 0, +0.8s]` |
| EmploymentStatus | `[−1.2s, −0.15s, +0.85s]` |
| Inflation | `[−0.4s, 0, +0.75s]` |
| PublicSentiment | `[−0.55s, 0, +0.65s]` |

### `tax`

| Node | Shift |
| --- | --- |
| SectorDemand | `[+0.9s, 0, −0.7s]` (suppresses demand) |
| IncomeClass | `[+0.2s, +0.15s, +0.05s, −0.1s, −0.25s, −0.3s]` |
| EmploymentStatus | `[+0.5s, +0.35s, −0.5s]` (toward unemployment/informal) |
| SpendingCapacity | `[+0.75s, 0, −0.4s]` |
| Inflation | `[+0.35s, 0, −0.3s]` |
| PublicSentiment | `[+0.5s, 0, −0.45s]` |
| ProtestRiskBand | `[−0.4s, 0, +0.6s]` |

### `housing`

| Node | Shift |
| --- | --- |
| SectorDemand | `[+0.2s, 0, +0.55s]` |
| IncomeClass | `[+0.3s, +0.2s, 0, −0.15s, −0.2s, −0.2s]` |
| EmploymentStatus | `[−0.3s, −0.1s, +0.2s]` |
| SpendingCapacity | `[−0.35s, 0, +0.3s]` |
| Inflation | `[−0.2s, 0, +0.45s]` |
| PublicSentiment | `[−0.6s, 0, +0.7s]` |
| ProtestRiskBand | `[+0.5s, 0, −0.45s]` |

Also: durable housing upgrade in the trajectory loop (`housing` allocation > 0.3
and `effectiveApplied` > 0.45), probability `0.02 × allocation.housing × months`
per period — **ASSUMPTION**.

### `education`

| Node | Shift |
| --- | --- |
| SectorDemand | `[+0.15s, 0, +0.35s]` |
| IncomeClass | `[0, 0, +0.05s, +0.1s, +0.12s, +0.1s]` |
| EmploymentStatus | `[−0.55s, −0.35s, +0.7s]` |
| PublicSentiment | `[−0.25s, 0, +0.35s]` |

### `regulation`

| Node | Shift |
| --- | --- |
| SectorDemand | `[+0.5s, 0, −0.2s]` |
| EmploymentStatus | `[+0.35s, +0.5s, −0.5s]` |
| PublicSentiment | `[+0.4s, 0, −0.3s]` |
| ProtestRiskBand | `[−0.4s, 0, +0.6s]` |

## 5. Micro mechanics in the trajectory loop (all assumptions)

| Mechanism | Formula | Basis |
| --- | --- | --- |
| Reachability (`reach`) | tax 1.0; informal 0.34; formal 0.92 | **ASSUMPTION** |
| Income update | `base × (0.985 + U(0,0.03)) × policyEffect`, where `base` is prior income or `6000 × classFactor` on re-entry | **ASSUMPTION**; re-entry base is below the modelled mean (flagged in the review). |
| `classFactor` | `[0.55, 0.78, 1.0, 1.5, 2.35, 4.3]` | **ASSUMPTION** |
| Employment policy effect | subsidy/labor `+3.5%`, else `+1.2%`, × `effectiveApplied` × `reach` × `(1 + allocation.employment × 0.6)` | **ASSUMPTION** |
| Savings stock | credited `(income − essentials)/essentials`, drawn at 0.06 × months; subsidy adds 0.05 × months × 0.1 | **ASSUMPTION** |
| Essentials | ₹3,200 + U(0,140) | **ASSUMPTION** |
| Sentiment carry | 35% chance to hold previous state | **ASSUMPTION** |
| Protest propensity | `0.72 × prev + 0.26 × (band/2) + 0.02 × (1 − trust)` | **ASSUMPTION** |
| Migration rate | `(0.012 + mobility × 0.03) × months × 0.34`, only when intent band = leave | **ASSUMPTION** |

## 6. Scenario levers (`SCENARIO_PRESETS`)

| Lever | Modest | Substantial | Extreme | Read by the engine? |
| --- | --- | --- | --- | --- |
| `capability` | 0.35 | 0.65 | 0.92 | **NO** |
| `adoption` | 0.20 | 0.45 | 0.80 | Yes → `adoptionRamp = adoption × min(1, (month+3)/36)` |
| `autonomy` | 0.15 | 0.50 | 0.85 | **NO** |
| `productivity` | 1.5 | 2.5 | 6.0 | **NO** |
| `reallocationMonths` | 4 | 12 | 30 | **NO** |

All four scenario presets are **ASSUMPTIONS** adapted from the Anthropic
Economic Index style of capability/adoption/autonomy framing; none is calibrated
to Pandharpur. Only `adoption` currently reaches the model, through
`ScenarioExposure` (via `exposureOf = clamp01(taskExposure + adoptionRamp × 0.35)`).
See `docs/BN_STRUCTURE.md` §7 and the review notes: the scenario selector
changes far less than it claims to.

## 7. Differential Evolution search ranges

| Gene | Lower | Upper | Unit |
| --- | --- | --- | --- |
| intensity | 0.05 | 1.0 | share |
| budget | 2,000,000 | 200,000,000 | INR |
| durationMonths | 3 | 60 | months |
| allocation.housing | 0.02 | 1.0 | relative weight (normalised) |
| allocation.education | 0.02 | 1.0 | relative weight (normalised) |
| allocation.employment | 0.02 | 1.0 | relative weight (normalised) |

Search controls (`DE/rand1bin`, population 24, 30 generations, dithering
`F = 0.6 × (0.5 + U)` and crossover 0.9) are engine settings, not policy
parameters, and are **ASSUMPTIONS**.
