# Meta Society — Simulation Lab Rebuild Specification

**Status:** Build blueprint. Hand this document to the implementing agent as the authoritative spec for the Simulation Lab.
**Scope:** Simulation Lab only. The **AI Policy Advisor is out of scope** — it is already working against the Groq API (`backend/`, called from `src/pages/AIAdvisor.tsx` via `VITE_API_URL`). Do not refactor it. The Simulation Lab must consume its output as *starting points*, not as results.
**Companion document:** the research paper *"Meta Society: A Simulation-Driven AI Policy Advisor for Data-Grounded Smart Governance"* (Chaugule, Kulkarni, Jadhav, Dongre). Sections 6, 7, and 8 of that paper are *proposals*. This document turns them into an implementable and testable design.

---

## 0. How to use this document

1. Read §1–§4 before writing any code. They define the problem, the design law, and — critically — what an "agent" is. Most of the current design ambiguity lives there.
2. Build in the phase order in §13. Each phase has explicit deliverables and acceptance criteria. Do not skip M1 (data) to get to the UI; the UI must render real engine output or it repeats the current mistake.
3. Every phase must end with its acceptance tests passing (§12). A phase without passing evidence does not count as done.
4. Where this document says **DECISION**, the choice is already made — implement it, don't re-litigate it. Where it says **OPEN**, record the answer back into this file.

---

## 1. Current state (verified against the repository)

| Area | Reality |
|---|---|
| Simulation Lab | `src/pages/SimulationLab.tsx` — a 3-second `setTimeout`, hardcoded `summaryMetrics` (`+1.0%`, `+3.2%`, `+11 pts`), and charts fed from `simulationMetrics` in `src/lib/mockData.ts`. No engine, no policy parameters flowing anywhere. |
| Policy inputs | `policyType` (`tax`/`subsidy`/`regulation`/`housing`/`labor`/`education`), `duration` (3–60 months), `budget` ($1–200M), `policyName`. These are the only knobs and they are never used. |
| Persistence | Supabase `simulations` table exists (`policy_name`, `policy_type`, `parameters` jsonb, `results` jsonb, `effectiveness_score`, `user_id`, RLS by user). Nothing writes to it from the Simulation Lab. |
| Frontend stack | Vite + React 18 + TS + Tailwind + shadcn/ui + Recharts + `@tanstack/react-query`. Supabase client at `src/integrations/supabase/client.ts`. |
| Data | No CSV, JSON, or Python data artifacts exist in the repo. All numbers are mock. |
| Backend | `backend/` is a Python FastAPI + LangGraph reference implementation for the Advisor only. `backend/requirements.txt`: fastapi, uvicorn, pandas, numpy, langgraph, openai, python-dotenv. |

**The gap in one sentence:** the Simulation Lab simulates nothing. It displays constants. Evaluators correctly flagged this, along with the data that would have to underpin it.

---

## 2. The design law: decisive, not generative

This is the single most important constraint in this document. Everything else follows from it.

> **The Simulation Lab must never ask a language model to produce a number, a percentage, a trend, or an outcome.** Numbers come from a probability model (Bayesian Network) and a search algorithm (Differential Evolution) over an explicit agent population. Language models in this system may only *decide* between pre-declared options and *report how confident* they are — never *generate* the content of a result.

Concretely, the following are **prohibited**:

- Any `setTimeout`-driven "running…" state that exists to look busy.
- Any hardcoded delta, metric, or chart series anywhere in the Simulation Lab render path. Delete `simulationMetrics` usage from `SimulationLab.tsx`; do not leave it as a fallback.
- Any LLM prompt whose output is a number or a narrative outcome ("GDP will grow by 3.1%").
- Any metric displayed without a distribution, an interval, or a provenance badge (§9.4).

And the following are **required**:

- Every displayed outcome is the deterministic function of `(population, policy vector, engine version, random seed)`. Re-running with the same four inputs must reproduce the identical result, bit-for-bit. This is the "replay" guarantee and evaluators will check it.
- Every dashboard number traces to a node in the Bayesian Network and an aggregation rule in §6.7.
- Every uncertainty is *modelled*, not decorated: a range must come from an actual distribution (Monte Carlo over the BN, or a population distribution), never from ±10% applied to a made-up point estimate.

**Why this matters for the paper:** it lets you write "the Simulation Lab is a probabilistic causal model with an evolutionary search layer, not a generative AI feature" — which is a far stronger claim than "we also use AI".

---

## 3. What is an agent? (the question that must be answered before anything is built)

The concern raised — *"is the agent representing a town or a person?"*, and *"if a city has East/West/North/South regions, how do four agents capture that?"* — is the correct concern, and it is a design bug in the paper's current framing if left implicit.

### 3.1 DECISION — the agent is a person, living in a household, in a ward, in a town

Three nested levels. Never collapse them.

```
TOWN ──► ZONE ──► WARD ──► HOUSEHOLD ──► PERSON (the agent)
```

- **The agent is one human being** with an individual state vector. It is *not* a town, *not* a zone, and *not* a "representative citizen". There are as many agents as there are modelled people.
- **Agents belong to households.** Households matter because income shocks, spending, and housing are household-level, not individual-level. A policy that raises one member's wage raises household consumption only partially (pooling and intra-household allocation).
- **Agents live in a ward.** Wards are the smallest spatial unit; a policy is felt differently in ward 7 than in ward 31.
- **Zones are a reporting lens over wards, not an entity.** See §3.3.

### 3.2 Agent state vector

Static attributes (assigned at population generation, never change during a run):

| Field | Type | Source |
|---|---|---|
| `agent_id` | string | deterministic hash |
| `town_id`, `ward_id`, `zone_id` | string | Census / ward map |
| `household_id` | string | generator |
| `age`, `sex` | int, enum | Census age pyramid + sex ratio |
| `sc_st` | bool | Census SC/ST share |
| `literate` | bool | Census literacy rate (gender-conditioned) |
| `education_level` | enum: none / primary / secondary / higher_secondary / graduate | modelled |
| `worker_status` | enum: non_worker / main / marginal | Census worker counts (gender-conditioned) |
| `sector` | enum: agriculture / manufacturing / services / pilgrimage_tourism / construction / trade / public_admin / informal_other | modelled |
| `income_class` | ordinal: BPL / low / lower_middle / middle / upper_middle / high | modelled, lognormal-calibrated to town mean + poverty rate |
| `housing_quality` | ordinal | modelled |
| `health_insurance` | bool | modelled |
| `infra_access` | ordinal | modelled |
| `informality` | bool | derived from sector + worker status |

Dynamic attributes (recomputed each simulation tick):

`employed`, `monthly_income`, `disposable_income`, `savings_buffer_months`, `consumption_basket_weights`, `sentiment` (ordinal), `trust_in_govt` (0–1), `protest_propensity` (0–1), `migration_intent` (0–1), `skill_relevance` (0–1, for the task-exposure layer).

Latent behavioural parameters (sampled once per agent, held fixed within a scenario, varied across scenarios in sensitivity runs):

`risk_aversion` β, `time_preference` δ, `mobility` m, `social_influence` s, `informal_network_reliance` n. These are what make two otherwise identical citizens respond differently, and they are what the Random Forest clustering step destroyed.

### 3.3 How East / West / North / South actually work (DECISION)

A town of 98,923 people cannot be honestly represented by four numbers. The resolution:

1. **Zones are a partition of wards**, not a set of agents. Map all 33 Pandharpur wards into 4 zones (East / West / North / South) by ward geography, balanced to roughly equal population. Every agent belongs to exactly one zone through its ward.
2. **The simulation runs on the full population.** East/West/North/South are computed *after* the run, as group-by aggregations: `mean(outcome | zone)` plus the full distribution and per-zone confidence intervals.
3. **The four "zone agents" shown in the UI are explicitly labelled as aggregates.** They render as *"Zone cohort summary: East — 24,780 residents"*, never as *"Agent East"*. If a single stylised figure is needed for the narrative, it is the **median agent of that zone** with its zone's interquartile spread attached, and the UI must show the spread. A single median with no spread is a lie by omission.
4. **Zone-level incidence is a first-class output**, not a decoration. The most valuable result a policymaker can get from this tool is the sentence *"this policy raises income 6% town-wide but 1.2% in the East and 11% in the North"*. That is the whole point of spatial agents.

Making the four zones explicit and honest is a strong, defensible upgrade over the paper's current framing: you move from *"ten representative agents for all of India"* (the abandoned Random Forest design) to *"every citizen modeled, aggregated into four zones for reporting"*.

### 3.4 Minimum defensible population

**DECISION — two tiers, both built:**

- **Tier A — Deep town (Pandharpur, Solapur district).** One agent per real resident: **98,923 agents**, Census-2011-anchored. Used for the flagship demo and the paper's quantitative claims. This single town alone exceeds the 80,000-record bar raised in evaluation.
- **Tier B — Portfolio scale.** The wider town corpus (2,500 town-level records), with an internally consistent agent sample per town (target ≥ 32 agents/town → ≥ 80,000 agents). Used to show the method generalises, and to support cross-town comparison.

Tier A is the priority. Tier B is the same generator run in sample mode and must not be allowed to block Tier A.

> **Portfolio run caveat that must appear in the UI and the paper:** the 2,500-town source records are themselves internally inconsistent (§4.1). Until they are regenerated, Tier B illustrates method scalability, not real geography. Label it as such.

---

## 4. The dataset problem and its solution

### 4.1 The two concerns raised in evaluation

1. **Scale:** 2,500 town-level records across six domains is too few to train and test agent-level models; ~80,000 records was named as the expected bar.
2. **Internal consistency:** demographic sub-totals (age brackets, gender splits) summed to the reported total population in **fewer than 6%** of records — the fields were generated independently rather than as a coherent synthetic town.

These are genuinely different problems. Padding the record count with more independently-sampled rows would satisfy (1) and make (2) worse. The generator must fix both at once.

### 4.2 DECISION — Census-anchored synthetic citizen population

Address the two concerns together by generating **one row per real person** in a real town, with real published totals as hard constraints and everything else modelled with enforced internal dependencies.

The raw material, already produced and available to the implementing agent as a CSV (place it at `data/pandharpur_citizens_census2011.csv`):

**Pandharpur Municipal Council, Solapur district — Census 2011, verified figures**

| Metric | Value |
|---|---|
| Total population | 98,923 (M 50,645 · F 48,278) |
| Households | 20,054 (≈4.9 persons/household) |
| Children aged 0–6 | 11,151 (11.27%) |
| Sex ratio | 953 F / 1,000 M |
| Literacy (effective) | Male 81.11% · Female 72.45% |
| SC / ST share | 12.34% / 5.47% |
| Total workers | 30,855 (M 25,162 · F 5,693) |
| Wards | 33 |

> **Discrepancy to resolve before publication:** one source reports literacy as 76.89%, another as 86.65%. These are almost certainly *crude* vs *effective* literacy (effective excludes under-7s). The figures above use the effective definition. **Verify both against the primary Census 2011 PDF** before these numbers appear in the paper, and state which definition is used.

### 4.3 The real-vs-modelled ledger (mandatory, and it is your strongest evaluator artifact)

Every field must be tagged, and that tag must be visible in the UI's provenance panel — not buried in a docstring.

| Field | Status |
|---|---|
| Population, gender split, household count, ward count, SC/ST share, literacy by gender, worker counts by gender, 0–6 age bracket | **Real** — matches published Census 2011 exactly |
| Other age-band proportions | **Estimated** — only 0–6 (11.27%) is confirmed; remaining bands use documented urban-Maharashtra age-pyramid shares |
| Sector of work, income class, housing quality, insurance, infrastructure | **Modelled** — Indian Census does not collect income; sector built from a documented estimate (pilgrimage economy dominant, per Pandharpur's known character) with internal correlations enforced |
| Latent behavioural parameters | **Assumed** — documented priors, varied in sensitivity analysis |

The defensible sentence for the panel is not *"we have real data"*. It is: **"here is exactly which fields are verified against Census 2011 and which are documented modelled assumptions, and the script asserts the verified totals match exactly."** That is stronger than either pure random data or an unevidenced realism claim.

### 4.4 Generation rules (Differential-DE-friendly, dependency-enforced)

Sampling must be **conditional**, never independent:

- **Income** ~ lognormal calibrated so the mean matches the town's reported mean and the lower tail mass matches the poverty rate. Income class is a discretisation of this draw.
- **Employment status** ~ Bernoulli weighted by the town's employment rate, **conditioned on working-age share and gender** (worker counts are strongly gender-skewed: 25,162 M vs 5,693 F — this skew must survive generation).
- **Literacy** must be conditioned on age (children excluded from effective literacy) and correlate monotonically with income class.
- **Sector** drawn from the modelled composition, conditioned on education and ward character (pilgrimage-adjacent wards heavier in trade/tourism).
- **Household assignment** such that mean household size lands on 4.93 and household size distribution is realistic (not all-4s-and-5s).
- **Wards**: distribute population across 33 wards to balance within ±10% unless real ward-level data is obtained.

### 4.5 Consistency assertions (build-blocking)

The generator script must exit non-zero if any of these fail:

```
assert sum(age_bands) == 98923
assert male_count + female_count == 98923
assert sex_ratio == 953 (±1)
assert mean(household_size) == 4.93 (±0.05)
assert sc_share == 0.1234 (±0.002) and st_share == 0.0547 (±0.002)
assert abs(worker_count_by_sex - census) / census < 0.01
assert corr(literate, income_class) > 0            # monotonic, strictly positive
assert P(worker | literate) > P(worker | not literate)   # observed ≈1.95× in the generated set
assert literacy_by_income_class is non-decreasing across classes   # observed 72.7% → 88.8%
assert every one of the 33 wards is populated
assert 100% of records satisfy age/gender sub-total consistency   # the <6% failure must become 100%
```

The last assertion is the headline number. The old dataset achieved <6%; the new one must achieve 100% **by construction**, and the test that proves it must be in the repo.

### 4.6 Where this can get more real (do if time allows, in priority order)

1. **Ward-level Census data** — `data.gov.in` / District Census Handbook town-wise Primary Census Abstract for Pandharpur. Replaces the even-ward-distribution assumption with real per-ward population/literacy, which makes zone differences *real* rather than modelled. Highest value.
2. **Sector/income** — NSSO consumption expenditure survey or the District Census Handbook industry-of-worker tables. Replaces the pilgrimage-economy estimate with sourced numbers.
3. **Task exposure** (§7) — O*NET-style task taxonomies mapped onto the sector mix.

### 4.7 Two ways to feed the existing pipeline (DECISION: do both, for different consumers)

- **Aggregates for the Advisor (unchanged consumer).** Aggregate the citizen file back into ward-level summary statistics shaped like the existing six town CSVs, so the LangGraph insight-generation step needs **zero changes**. Use `backend/scripts/aggregate_citizens.py`.
- **Citizen-level for the simulation engine.** The BN/DE/agent layers consume the citizen rows directly. Use `data/agents/pandharpur.agents.jsonl`.

Do not force one representation on both consumers.

---

## 5. Engine architecture

### 5.1 Where each piece runs (DECISION)

The paper already established the precedent and it still holds: the production runtime is Deno/TypeScript and cannot run Python or Pandas.

| Component | Runtime | Why |
|---|---|---|
| Population generation, CPT estimation, calibration, validation harness | **Python** (offline, `backend/scripts/`, `engine/`) | Needs pandas/numpy/scipy/pgmpy. Runs as a build/research step, never in a request path. |
| Frozen artifacts (agent population, CPT tables, calibration constants) | **JSON, versioned in-repo** under `data/frozen/` | Removes the paper's "static snapshot must be manually regenerated" limitation: regeneration becomes a scripted build step with a hash. |
| Bayesian Network inference + Differential Evolution + aggregation | **Supabase Edge Function (Deno/TS)** `supabase/functions/simulate/` | Small discrete DAG → variable elimination is cheap in TS; DE over ~6 parameters is trivial. Runs inside the request path. |
| Decision layer (§8) | Called from the Edge Function | Network call from server-side only; never expose its key to the browser. |
| Orchestration, results rendering | React + Supabase | Existing stack. |

This mirrors the port the team already did for the Advisor (Python reference → TS Edge Function + precomputed Pandas snapshot), but with a **scripted, hashed regeneration step** instead of a manual one — which directly answers the limitation the paper lists in §9.

**Fallback if the Edge Function runtime is unavailable:** the same TS engine module must be importable by a Vite-side worker or a `POST` route on the existing FastAPI `backend/`. Keep the engine in a framework-free module (`engine/ts/`) with no Deno- or Node-specific imports except an injectable fetch, so it runs in all three.

### 5.2 Repository layout to create

```
data/
  raw/pandharpur_census2011_reference.json     # the verified numbers + provenance
  raw/pandharpur_wards.csv                     # ward → zone map
  agents/pandharpur.agents.jsonl               # 98,923 rows (generated, gitignored if large)
  frozen/population_manifest.json              # hash, counts, generator version
  frozen/bn_cpts.v1.json                       # conditional probability tables
  frozen/bn_structure.v1.json                  # DAG edges + node domains
  frozen/calibration.v1.json                   # macro calibration constants + targets
engine/ts/
  bn.ts            # DAG traversal, variable elimination, do-calculus
  de.ts            # Differential Evolution + NSGA-II Pareto front
  agents.ts        # per-agent reaction step
  aggregate.ts     # micro → macro aggregation identities (§6.7)
  decision.ts      # System One decision layer interface + adapters (§8)
  simulate.ts      # the single entry point: (policy, population, seed) → SimulationResult
  types.ts         # shared contracts (§10)
engine/py/
  generate_population.py
  fit_bn.py
  calibrate.py
  validate.py
supabase/functions/simulate/index.ts
supabase/migrations/<ts>_simulation_runs.sql
src/pages/SimulationLab.tsx        # rewritten
src/lib/simulation/                # client types, react-query hooks, chart adapters
```

### 5.3 Hard runtime constraints for this workspace

- Keep the existing Vite/React entrypoint, providers, and Tailwind foundation intact. Do not add a second React or a second router.
- `vite.config.ts` must not be modified. HMR stays disabled; never add `hmr: true` or an `hmr: {...}` object.
- The build command stays `vite build` producing `dist/` and exiting. Never start a server in the build step.
- Do not launch long-running processes from the terminal, and never hand-edit generated Convex/Supabase type files.
- Large data files: if `pandharpur.agents.jsonl` exceeds a few MB, generate it deterministically from `generate_population.py` + a fixed seed at build time rather than committing it, and commit only the manifest and the small frozen artifacts. The engine must be able to accept a population from storage as well as from a bundled artifact.

---

## 6. The Bayesian Network (paper §6, made concrete)

### 6.1 Formulation

A BN over discrete (or discretised) random variables `X = {X₁ … Xₙ}` specified by a DAG `G` and conditional probability tables `P(Xᵢ | parents(Xᵢ))`. Joint distribution factors as the product of the CPTs. Inference = computing `P(X_unknown | X_evidence)`, by:

- **Exact:** variable elimination (default; the graph is small and mostly polytree-shaped).
- **Approximate:** likelihood weighting with 10,000 samples, when the network is extended with agent-level randomness or when a full posterior over many nodes is needed at once.

Both must be implemented. Exact where it is affordable; sampling is also what produces the fan charts in the UI, so it is needed regardless.

### 6.2 Node set and domains (v1)

Parentheses list parents.

| Node | Domain | Parents |
|---|---|---|
| `PolicyType` | {none, tax, subsidy, regulation, housing, labor, education} | — |
| `PolicyIntensity` | {low, medium, high} | PolicyType |
| `PolicyBudgetShare` | {low, medium, high} | PolicyType |
| `PolicyDuration` | {short≤12m, medium≤36m, long≤60m} | PolicyType |
| `SectorDemand` | {contracting, flat, growing} | PolicyType, PolicyIntensity, PolicyBudgetShare |
| `TaxBurden` | {low, medium, high} | PolicyType, PolicyIntensity |
| `IncomeClass` | 6 ordered bands (§3.2) | IncomeClass_prior, PolicyType, PolicyBudgetShare, SectorDemand |
| `EmploymentStatus` | {unemployed, informal, formal} | IncomeClass, SectorDemand, PolicyType, PolicyIntensity |
| `SpendingCapacity` | {constrained, stable, comfortable} | IncomeClass, EmploymentStatus, TaxBurden |
| `SkillRelevance` | {obsolete, shifting, durable} | SectorDemand, EducationLevel (§7) |
| `SectorOfWork` | 8 sectors | IncomeClass, EducationLevel, SectorDemand, SkillRelevance |
| `HouseholdStress` | {low, medium, high} | IncomeClass, EmploymentStatus, SpendingCapacity, HousingQuality |
| `Inflation` | {low, moderate, high} | SpendingCapacity (aggregate), SectorDemand, PolicyBudgetShare |
| `PublicSentiment` | {negative, neutral, positive} | IncomeClass, EmploymentStatus, Inflation, TrustInGov, PolicyType |
| `ProtestRisk` | {low, medium, high} | PublicSentiment, TrustInGov, HouseholdStress, PolicyType |
| `MigrationIntent` | {stay, consider, leave} | EmploymentStatus, SkillRelevance, PublicSentiment, AgeBand |
| `SectorOutput` | {declining, stable, rising} | SectorDemand, EmploymentStatus, SkillRelevance |
| `TownGDPGrowth` | 5 ordered bands (<0, 0–1, 1–2.5, 2.5–4, >4 %) | SectorOutput (all sectors aggregated), EmploymentStatus, Inflation |
| `EmploymentRate` | 5 ordered bands | EmploymentStatus, MigrationIntent, TownGDPGrowth |
| `WageLevel` | 5 ordered bands | TownGDPGrowth, EmploymentRate, Inflation, SkillRelevance |

`TrustInGov`, `HousingQuality`, `EducationLevel`, `AgeBand`, `IncomeClass_prior` are exogenous/agent attributes — either observed from the population or fixed as evidence per agent.

**`TownGDPGrowth` parents are per-sector `SectorOutput` nodes.** Instantiate one `SectorOutput` node per sector (8). That single modelling choice is what makes the network produce a *decomposable* growth number instead of one black-box output, and it is what drives §6.7.

### 6.3 Causal chain the structure must express

The paper's §6.2 chain, made explicit:

```
Policy ──► IncomeClass ──► EmploymentStatus ──► SpendingCapacity
                                   │                    │
                                   │                    ▼
                                   │            (aggregate) Inflation
                                   │                    │
                                   ├──► SectorDemand ───┤
                                   │        │           │
                                   ▼        ▼           ▼
                              HouseholdStress    PublicSentiment ──► ProtestRisk
                                   │                    │
                                   ▼                    ▼
                          WageLevel/MigrationIntent  EmploymentRate
                                   │
                                   ▼
                        SectorOutput ──► TownGDPGrowth
```

Complexity: ~20 node families, ≤5 parents per node, domains ≤8. Exact inference is comfortably affordable.

### 6.4 CPTS: estimation and priors

- Estimate CPTs from the generated agent population (`engine/py/fit_bn.py`) using maximum-likelihood with **Laplace / Dirichlet smoothing** (α = 1) to avoid zero-probability cells — a zero CPT cell silently makes evidence impossible and will produce nonsense.
- Where the population cannot inform a CPT (policy nodes, inflation, protest), supply **documented priors** from domain literature on income/employment/well-being relationships, recorded in `bn_cpts.v1.json` with a `source` field per table: `"estimated_from_population"` or `"prior:literature"` or `"prior:assumption"`.
- **Every CPT must carry its provenance.** A table with no provenance is a bug.

### 6.5 Inference modes the API must expose

1. **Forward prediction:** `P(outcome | policy vector, agent attributes)` — the default.
2. **Intervention (do-calculus):** `P(outcome | do(PolicyBudget = x))` with parents of the intervened node cut. Necessary to distinguish "we observe a policy was applied" from "we impose a policy". For a decision-support tool, only the latter is honest.
3. **Counterfactual / baseline:** the identical query under `PolicyType = none`, so every result ships with its own baseline from the *same* network rather than a hardcoded comparison series.
4. **Individual + population:** run per-agent evidence (attributes as soft evidence) and aggregate; also run on a single "median agent" for the UI's quick view, clearly labelled.

### 6.6 Validation of the network (mandatory, before it is trusted)

Directional sanity checks — assert the sign of the response, not a magnitude:

```
assert P(EmploymentStatus=formal | do(PolicyType=subsidy, intensity=high)) > prior(EmploymentStatus=formal)
assert P(Inflation=high | do(PolicyBudgetShare=high)) > prior(Inflation=high)
assert P(PublicSentiment=positive | do(PolicyType=housing, intensity=high)) > prior(PublicSentiment=positive)
assert P(MigrationIntent=leave | EmploymentStatus=unemployed, SkillRelevance=obsolete) > prior(MigrationIntent=leave)
assert P(TownGDPGrowth in {2.5-4, >4} | do(PolicyType=education, duration=long)) > prior(TownGDPGrowth in {2.5-4, >4})
```

Then hold-out calibration: fit CPTs on a 70% agent split, evaluate log-likelihood on the held-out 30%, and report it. A network that only fits the data it was built from is not validated.

Also report **sensitivity**: for each policy parameter, the partial derivative of the key outcome nodes, so the paper can state which parameters the model is actually sensitive to.

### 6.7 Aggregation rules — the identities that make it a model and not a story

Each agent step produces a distribution over `EmploymentStatus`, `SectorOfWork`, `SpendingCapacity`, and the derived monetary quantities. The aggregate must be **computed from the population**, using stated identities. No macro number may be set directly.

```
employed_count        = Σ_agents 1[EmploymentStatus ∈ {informal, formal}]
employment_rate       = employed_count / working_age_count
participation_rate    = labour_force_count / working_age_count
mean_income           = Σ_agents income_i / population
gini                  = gini(income_1 … income_n)
sector_output_s       = Σ_{agents in sector s} productivity_i × hours_i × demand_multiplier_s
town_gdp_growth       = (Σ_s sector_output_s(post) − Σ_s sector_output_s(base)) / Σ_s sector_output_s(base)
inflation             = f(aggregate_demand / aggregate_supply)        # state f explicitly
wage_index            = Σ_agents wage_i / employed_count, indexed to base
happiness_index       = (Σ_agents mapped_sentiment_i) / population
protest_risk_town     = 1 − Π_agents (1 − protest_propensity_i)        # union of independent risks
migration_outflow     = Σ_agents 1[MigrationIntent = leave] / population
```

**Accounting constraints (hard assertions, must hold every run):**

```
budget_outlay   = Σ_sector spend_s + Σ_transfers
budget_revenue  = Σ_agents tax_paid_i + external_funding
assert |budget_outlay − budget_revenue| / budget_revenue < 0.01   # no free money
assert employed_count + unemployed_count + non_worker_count == population
assert Σ_sector employed_s == employed_count
assert all zone populations sum to town population
```

Violating an identity must fail the run loudly, not silently clamp. This is what separates a simulator from a random-number generator, and it is the first thing a technical evaluator will probe.

---

## 7. Task-exposure economic layer (the Anthropic "Economic Scenarios" analogue)

The reference to Anthropic's Economic Scenarios work (Korinek et al., 2026; the task-bundle model of the economy, with augmentation / automation / unchanged / new-task decomposition, adoption and autonomy parameters, and GDP / wages / unemployment outputs under modest, substantial, and extreme scenarios) points at something the current design lacks: an explicit **mechanism** connecting a technology or capability change to labour demand. Right now `SectorDemand` is a CPT with no economic story behind it.

Add a thin but real layer above the BN:

### 7.1 Task-bundle representation

For each agent, represent its occupation as a bundle of tasks with exposure weights:

```
task_bundle_i = [ { task_id, sector, exposure: {automation: 0–1, augmentation: 0–1}, share: 0–1 } ]
```

Derive bundles from the sector mix plus a documented task taxonomy (O*NET-style; for an Indian municipal context, map to PLFS/NSSO occupation groups where available — otherwise document the mapping as modelled).

### 7.2 Exposure → `SkillRelevance` → `SectorDemand`

The BN already has `SkillRelevance` and `SectorDemand` nodes. Give them an actual driver:

```
exposure_i     = Σ_t share_t × (w_auto × automation_t + w_aug × augmentation_t)
skill_relevance_i ← discretise(1 − exposure_i), conditioned on sector and education
sector_demand_s  ← shift by mean(exposure) over sector s under the scenario's adoption + autonomy settings
```

This is what lets the Simulation Lab answer the question the paper's framing invites: *"if AI adoption in this sector reaches X by year Y, what happens to employment, wages, and the income distribution in this town — and who bears it?"* That is a genuinely differentiating capability, and it reuses the BN rather than bolting on a second model.

### 7.3 Scenario explorer

Expose the four policy-independent levers as first-class scenario inputs, mirroring the reference framing:

| Lever | Range | Meaning |
|---|---|---|
| Capability | 0–100% | share of knowledge tasks AI can perform |
| Adoption | 0–100% | share of firms/agents that actually use it |
| Autonomy | none → almost all | how much runs without a human |
| Productivity multiplier | 1× – 10×+ | output gain on augmented/automated tasks |
| Reallocation time | 1 month – 3+ years | how fast displaced agents find new work |

Preset scenarios: **Modest / Substantial / Extreme**, plus custom. Every scenario is a `SimulationScenario` row (§10.4) and is reproducible from its lever values.

### 7.4 What must be honest here

The reference work is calibrated to the *US* economy with authoritative microdata. Pandharpur's exposure mappings are modelled. So:

- Label this layer **"illustrative scenario analysis"**, never **"forecast"**.
- Report the sensitivity of outputs to the exposure assumptions, and show what happens at exposure = 0 (the null model).
- State the mapping's provenance in `calibration.v1.json` alongside every other modelled constant.

A rigorously-labelled scenario layer is defensible. An unlabelled one is the kind of thing that ends a viva.

---

## 8. The decision layer: a System One model (Jev) — why it belongs in the Simulation Lab

### 8.1 What Jev is (verify before implementing — early access)

TypeSafe AI released **Jev** on 15 September 2026, the first of a class they call **System One models**. It is a decision model, not a chat model: it takes **unstructured state in** and returns **typed decisions out**, with **calibrated probabilities**. It does not generate prose, and by construction it cannot produce a type error. Three question primitives:

| Primitive | Returns |
|---|---|
| `Choice` | one option from a declared list (up to 255), with a probability distribution over the options and a derived confidence |
| `Score` | a position on an application-defined ordered rubric, with distribution + confidence |
| `Noul` | probability that a stated proposition about the state is true (0–1) |

Reported characteristics: ~70–500 ms per call, all declared questions evaluated in parallel (so five questions cost roughly one), input at $0.042/MTok with output too cheap to meter, and no hallucination because there is no free-form output. It is distributed through at least one AI gateway as `typesafe-ai/jev`.

Two properties make it the right tool for this specific system:

1. **Latency and cost are inside the budget of an agent loop.** A generative model at 3–329 s per call cannot make a decision for even 1,000 agents. A ~100 ms typed call can. That is the difference between "we simulated a population" and "we simulated four agents".
2. **The set of valid answers is declared by our code, before inference.** That is exactly the property the design law in §2 requires: the model picks among options our model defines, and cannot invent a number.

### 8.2 Where it goes — five concrete uses, all decision-shaped

Implement as `engine/ts/decision.ts` behind an interface (§8.4). Each use is a **typed question with a declared answer set**, and each answer is consumed by the Bayesian Network or the aggregator — never displayed as a result on its own.

**U1 — Discrete branch resolution in the agent reaction step.** Some transitions are genuine discrete choices that a CPT can only blur: does this specific agent retrain, switch sector, migrate, or stay? Declare a `Choice` over those options; use the returned distribution as *soft evidence* to the BN, and the derived confidence to decide whether the agent is resolved deterministically or carried forward as a distribution.

**U2 — Proposition testing over agent state (`Noul`).** Fast binary judgements that would otherwise need hand-tuned thresholds, e.g. *"given this agent's savings buffer and employment status, is this household financially distressed?"* or *"is this agent's skill set exposed to automation under this scenario?"* Returned probability feeds `HouseholdStress` / `SkillRelevance` as soft evidence.

**U3 — Severity scoring (`Score`).** Rank a state on a declared rubric — e.g. protest severity ∈ {calm, vocal, disruptive, violent}, or policy feasibility ∈ {infeasible, marginal, feasible, well-supported}. Scores populate `ProtestRisk` and gate infeasible policy vectors before they consume compute.

**U4 — Verification / guardrails on engine output (the highest-value use).** After the BN and DE produce a result, ask constrained questions *about that result*: *"is this outcome vector internally consistent with the stated policy?"*, *"does this result violate any accounting identity?"*, *"is this scenario's headline claim contradicted by its own per-zone breakdown?"* This is a cheap, always-on self-check layer, and it is the answer to "how do you know the simulator isn't producing nonsense?"

**U5 — Confidence-gated human escalation.** Every answer carries a confidence. Implement one policy: **above threshold → automate** (the result is shown as a decided outcome); **below threshold → escalate** (the result is shown with an uncertainty badge and flagged for review). Report the escalation rate per run. This is the property that makes the whole system safe to put in front of a policymaker, and it is a genuinely novel contribution to write up: *a decision-support simulator that knows when it does not know.*

### 8.3 What Jev must never do here

- Never produce a metric, percentage, trend, narrative, or recommendation text.
- Never be the source of a displayed number. It produces *decisions and probabilities* that the BN and the aggregator consume. If a displayed value would change when only the Jev key is removed, that is a bug.
- Never be called from the browser. Server-side only (Edge Function), key in Supabase secrets. Note the paper's own point about Vite-prefixed env vars being bundled into client code — it applies here identically.

### 8.4 The interface, and the required fallback

```ts
export interface DecisionEngine {
  choose<T extends string>(state: string, question: ChoiceQuestion<T>): Promise<Decision<T>>;
  score(state: string, question: ScoreQuestion): Promise<Decision<string>>;
  evaluate(state: string, statements: string[]): Promise<NoulResult[]>;
}
export interface Decision<T> { answer: T; distribution: Record<T, number>; confidence: number; }
```

Ship **three adapters**, selectable by env var:

1. `JevDecisionEngine` — the real integration. Verify current API access, endpoint, auth, and primitive names against TypeSafe's docs at implementation time; early-access APIs move.
2. `LlmDecisionEngine` — constrains a generative LLM to the same declared-answer schema (TypeSafe publish a wrapper for exactly this). Slower and costlier, same interface. This is the graceful degradation path and the ablation baseline.
3. `RuleDecisionEngine` — a deterministic threshold/rule table. Fully offline. **This one is mandatory**, because it is the control condition: if `RuleDecisionEngine` and `JevDecisionEngine` produce materially different simulation outcomes, that difference is a result worth reporting. If they don't, that is also a result — it means the typed decisions were not doing the work, and you should say so.

Every `SimulationRun` records which engine produced it (§10.4). Results across engines are comparable because the interface is fixed.

---

## 9. Simulation Lab UI/UX specification

`src/pages/SimulationLab.tsx` is rewritten. Delete the `simulationMetrics` import from the render path.

### 9.1 Layout

Left rail — inputs. Center — results. Right rail — provenance and confidence.

**Left rail (policy vector, replaces ad-hoc `policyType`/`name`):**

| Input | Control | Bounds |
|---|---|---|
| Instrument | select: tax / subsidy / regulation / housing / labor / education transfer | — |
| Intensity | slider | 0–100% |
| Budget | slider, currency, must satisfy the budget identity | 0–200M |
| Duration | slider | 3–60 months |
| Allocation split | 3 sliders summing to 100% (housing / education / employment) | — |
| Target zone filter | East / West / North / South / all | optional |
| Scenario levers | capability, adoption, autonomy, productivity, reallocation (§7.3) | — |
| Seed | number input, defaults to a random integer shown in the header | — |

Include **"Start from an Advisor recommendation"**: the existing AI Advisor's suggested policy seeds the instrument and intent. This connects the two halves of the product without letting the Advisor produce the numbers.

### 9.2 Results

1. **Outcome cards with distributions** — GDP growth, employment rate, wage index, inflation, happiness, Gini, protest risk, migration outflow. Each card shows point estimate **plus 90% credible interval**, plus a small inline histogram. Cards never show a bare number.
2. **Baseline overlay** — every chart plots the counterfactual from the *same network* (§6.5.3), not a hardcoded dashed line.
3. **Zone incidence panel** — the four zones side by side, per metric, with the town-wide value for reference. Explicitly: *"East +1.2% · West +3.4% · North +11.0% · South +4.1% · Town +6.0%"*.
4. **Distribution view** — income distribution and sentiment distribution, before vs after, as overlapping density or quantile bands. This is where the synthetic population pays off: you can show that a policy with a good average outcome still harms a specific decile.
5. **Pareto front** — when the objective is multi-objective, render the non-dominated set (e.g. employment gain vs inflation) with each candidate selectable, and the selected candidate shown in detail.
6. **DE convergence** — fitness vs generation, plus the population's spread, so the search is auditable rather than a black box.
7. **Causal explanation panel** — for a selected outcome node, show the highest-influence upstream nodes (from the BN). This is the *explainability* deliverable that the Random Forest could not provide; it is the paper's §5 argument made visible.
8. **Ranked policy table** — top-N candidates with parameters, expected outcomes, intervals, and feasibility, sortable.

### 9.3 Interaction honesty

- Run button triggers a real request. Duration is whatever the engine takes; no minimum display time.
- While running, show real progress if the engine emits it (generation index, % of agents processed). If the engine cannot report progress, show an indeterminate state and say so. **Never fake progress.**
- Failed accounting identity → an error card naming the violated identity, not a silent fallback.
- Save → writes to `simulations` (§10.4) and appears in Saved Reports. Export → real CSV/JSON of the actual results.

### 9.4 Provenance and confidence (right rail)

A persistent panel listing, for this run:

- Population: tier, town, agent count, `population_manifest` hash
- Engine versions: BN structure + CPT versions, DE params, decision engine name, seed
- Data ledger: the §4.3 real-vs-modelled table, scoped to the fields this run used
- Decision-layer calibration: escalation rate (fraction of decisions below confidence threshold), mean confidence
- Guardrail results: which U4 checks ran and their outcomes
- Explicit caveat: *"Illustrative scenario analysis, not a forecast"* where §7 is engaged

This panel is not decoration. It is the artifact that makes the whole project defensible in evaluation, and it should be screenshot-ready.

---

## 10. Data contracts

### 10.1 Citizen population (JSONL, one agent per line)

```jsonc
{
  "agent_id": "pdh-000001",
  "town_id": "pandharpur_in_mh",
  "ward_id": "W07",
  "zone_id": "east",
  "household_id": "H00312",
  "age": 34, "age_band": "30-39", "sex": "F",
  "sc_st": false, "literate": true, "education_level": "secondary",
  "worker_status": "main", "sector": "trade", "informality": false,
  "income_class": "lower_middle", "monthly_income": 11300,
  "housing_quality": "adequate", "health_insurance": false, "infra_access": "partial",
  "latent": { "risk_aversion": 0.62, "time_preference": 0.71, "mobility": 0.33, "social_influence": 0.48 },
  "task_bundle": [ { "task_id": "T104", "sector": "trade", "automation": 0.42, "augmentation": 0.31, "share": 0.6 } ],
  "provenance": { "income_class": "modelled", "sector": "modelled", "sex": "census2011", "literate": "census2011" }
}
```

Field-level provenance is part of the record, so the §4.3 ledger is machine-generated rather than hand-maintained.

### 10.2 Frozen BN artifacts

```jsonc
// bn_structure.v1.json
{ "version": "1.0.0", "created": "2026-..-..", "hash": "sha256:...",
  "nodes": [ { "id": "EmploymentStatus", "domain": ["unemployed","informal","formal"], "parents": ["IncomeClass","SectorDemand","PolicyType","PolicyIntensity"], "kind": "estimated" } ] }
// bn_cpts.v1.json
{ "version": "1.0.0",
  "tables": { "EmploymentStatus": { "parent_key": "IncomeClass=lower_middle|SectorDemand=growing|PolicyType=subsidy|PolicyIntensity=high",
      "distribution": { "unemployed": 0.11, "informal": 0.44, "formal": 0.45 }, "source": "estimated_from_population" } } }
```

### 10.3 Engine API (Edge Function)

```ts
// POST /functions/v1/simulate
interface SimulateRequest {
  town_id: string;
  policy: { instrument: "" | "tax" | "subsidy" | "regulation" | "housing" | "labor" | "education";
            intensity: number; budget: number; duration_months: number;
            allocation: { housing: number; education: number; employment: number } };
  scenario?: { capability: number; adoption: number; autonomy: number; productivity: number; reallocation_months: number };
  objectives?: ("employment" | "inflation" | "gdp" | "happiness" | "gini" | "migration")[];
  mode: "single" | "optimize";
  seed: number;
  bn_version: string;
}
interface SimulateResponse {
  run_id: string; engine: { bn: string; de: string | null; decision: string };
  seed: number; population_manifest: string;
  point: Record<MetricKey, number>;
  intervals: Record<MetricKey, { p05: number; p50: number; p95: number }>;
  by_zone: Record<"east"|"west"|"north"|"south", Record<MetricKey, { p05: number; p50: number; p95: number }>>;
  distributions: { income: Quantile[], sentiment: Quantile[] };
  baseline: SimulateResponse["point"];
  pareto_front?: { params: PolicyParams; objectives: Record<string, number>; selected: boolean }[];
  convergence?: { generation: number; best: number; mean: number; spread: number }[];
  causal_attribution?: { node: string; influence: number }[];
  guardrails: { check: string; passed: boolean; note?: string }[];
  decision_stats: { engine: string; calls: number; mean_confidence: number; escalation_rate: number };
  warnings: string[];
}
```

### 10.4 Database migration

Extend, don't replace. `simulations` already holds `policy_name`, `policy_type`, `parameters`, `results`, `effectiveness_score`.

```sql
alter table simulations
  add column if not exists run_id text unique,
  add column if not exists seed bigint,
  add column if not exists engine_versions jsonb,     -- { bn, de, decision }
  add column if not exists population_manifest text,
  add column if not exists policy_vector jsonb,        -- the real encoded vector (§11.1)
  add column if not exists intervals jsonb,
  add column if not exists by_zone jsonb,
  add column if not exists pareto_front jsonb,
  add column if not exists decision_stats jsonb,
  add column if not exists guardrails jsonb;

create table if not exists simulation_scenarios ( ... );  -- §7.3 levers, named, reusable
create table if not exists populations ( ... );           -- manifest, tier, town, count, hash, provenance summary
```

Keep RLS scoped to the authenticated user on all of them, matching the existing three tables.

---

## 11. Differential Evolution (paper §7, made concrete)

### 11.1 Encoding (DECISION — matches the UI's input set)

```ts
interface PolicyParams {
  intensity: number;              // [0, 1]
  budget: number;                 // [0, 200e6]
  duration_months: number;        // [3, 60]
  allocation_housing: number;     // [0, 1], with education + employment summing to 1
  allocation_education: number;   // [0, 1]
  allocation_employment: number;  // [0, 1]
}
```
Note the constraint surfaces: `budget ≤ f(revenue capacity)` and `allocations sum to 1`. Handle both by penalised fitness — never by silently clamping a candidate, because clamping destroys the population's diversity and biases the front.

### 11.2 Algorithm parameters (starting point, tune and record)

| Parameter | Value |
|---|---|
| Population size NP | 10 × D, D = 6 → 60 |
| Strategy | `DE/rand/1/bin`, with `DE/best/1/bin` in a second reported run |
| F (mutation) | 0.5, with dithering ∈ [0.5, 1.0] |
| CR (crossover) | 0.9 |
| Generations | 200, early stop on stagnation of 30 generations |
| Initialisation | Latin hypercube over the box constraints (better coverage than uniform) |
| Seeds | fixed, recorded per run |

### 11.3 Fitness

Single-objective: a weighted scalar of the BN's predicted outcomes for the candidate (GDP growth, employment change, sentiment, inflation), with weights exposed as a UI control *and* recorded in the run. Multi-objective: **NSGA-II** producing a **Pareto front** (Deb et al., 2002 — already in the reference list) over conflicting objectives, which is the honest framing when "reduce unemployment" and "contain inflation" conflict. The UI must present the front as a choice for the policymaker, not silently pick one.

Fitness evaluation is the BN's predicted distribution for that candidate over the population — so each generation costs `NP × (agents or agent-subset)` inferences. **Use stratified sampling of the population during search** (e.g. 2,000 agents stratified by zone × income_class × sector) and evaluate the final front on the full population. Record the stratification so it is auditable. Otherwise a 60 × 200 = 12,000-evaluation search over 98,923 agents will not finish.

### 11.4 Reporting

Report convergence curves, the seed set, the strategy used, and the chosen tie-break. A DE run with no convergence plot is not evidence. Also run and report the **null comparison**: random search of the same budget. If DE does not beat random search on this fitness landscape, that is a real finding and must be reported rather than hidden.

---

## 12. Validation and the evaluator evidence pack

Everything below must be reproducible by a third party from the repo. Produce `VALIDATION.md` with the actual outputs.

**Data layer**
- [ ] Generator exits non-zero on any §4.5 assertion failure.
- [ ] Census totals match exactly; a test prints the diff table (all zeros).
- [ ] **100%** of records pass age/gender sub-total consistency (baseline: the old dataset's <6%).
- [ ] Literacy increases monotonically across income classes; literate agents are materially more likely to be workers.
- [ ] Household size distribution centred on 4.93; all 33 wards populated.
- [ ] Every field carries a `real` / `estimated` / `modelled` tag, and a script regenerates the §4.3 ledger table from those tags.

**BN layer**
- [ ] All §6.6 directional checks pass.
- [ ] Held-out log-likelihood reported on a 70/30 split.
- [ ] Exact vs sampling inference agree within Monte Carlo error on 20 random queries.
- [ ] Intervention queries (`do(...)`) differ from observational queries where the graph predicts they should.
- [ ] Sensitivity table: outcome response to each policy parameter.

**DE layer**
- [ ] Convergence curve per run, recorded.
- [ ] DE beats random search of equal budget on the same fitness, or the negative result is reported.
- [ ] Pareto front is verified non-dominated (a test asserts no candidate dominates another).
- [ ] Same seed → identical front.

**Reproducibility (the headline test)**
- [ ] Same `(population, policy vector, bn_version, de params, seed)` → byte-identical `SimulateResponse`.
- [ ] Changing only the seed changes the result within the reported intervals and not beyond them.
- [ ] Population manifest hash changes when any generator input changes.

**Decision layer**
- [ ] All three adapters (§8.4) satisfy the same interface and are exercised by the same test suite.
- [ ] Removing the Jev key degrades to the fallback and the run still completes.
- [ ] Displayed metrics are invariant to the decision adapter *except* where the adapter is the intended cause — and any difference is quantified and reported.
- [ ] Escalation rate and mean confidence are recorded per run.

**System**
- [ ] Accounting identities hold on every run in the test suite.
- [ ] Guardrail checks (U4) run on every simulation and their results are persisted.
- [ ] No code path in the Simulation Lab renders a hardcoded metric. A test greps the render tree for `mockData` imports and fails if found.

---

## 13. Phased plan

**M0 — Contracts and data skeleton (small).**
Freeze the types in §10, the `raw/pandharpur_census2011_reference.json` with per-field provenance, and the ward → zone map. Deliverable: `engine/ts/types.ts`, the reference JSON, the ward map, and the §4.3 ledger generator. Acceptance: ledger table generated from tags, no data yet required.

**M1 — Synthetic population.**
`engine/py/generate_population.py` producing `pandharpur.agents.jsonl` (98,923 rows) plus Tier B sample mode. Acceptance: every §4.5 assertion passes; `VALIDATION.md` data section filled with real output.

**M2 — Bayesian Network.**
Structure + CPT fitting + inference (exact and sampling) + `do`-calculus, exported to frozen JSON. Acceptance: all §6.6 checks, held-out likelihood, sensitivity table.

**M3 — Aggregation and identities.**
`aggregate.ts` implementing §6.7, with the accounting assertions. Acceptance: identities hold across 50 randomised policy vectors; a deliberately violated budget fails loudly.

**M4 — Differential Evolution.**
`de.ts`, single-objective and NSGA-II, stratified evaluation. Acceptance: convergence, seed determinism, non-dominated front, random-search comparison.

**M5 — Decision layer.**
`decision.ts` with all three adapters; U1–U5 wired. Acceptance: fallback works without keys; escalation rate and confidence reported; displayed metrics invariant to adapter except where quantified.

**M6 — Edge Function, persistence, UI.**
`supabase/functions/simulate/index.ts`, the migration in §10.4, and the rewritten Simulation Lab per §9. Acceptance: a real run from the browser produces engine-derived numbers with intervals, zone incidence, Pareto front, causal attribution, and a populated provenance rail; Save writes to `simulations`; the `mockData` grep test passes.

**M7 — Task-exposure layer (optional, if time).**
§7 wired as scenario levers feeding `SkillRelevance` and `SectorDemand`, with presets and honest labelling.

Order matters. Do not start M6 before M4 passes — a UI over an unvalidated engine is exactly the failure being corrected.

---

## 14. Non-goals

- Rewriting or re-architecting the AI Policy Advisor. It works. Leave it.
- Adding a second backend framework beyond the Edge Function + existing FastAPI reference.
- Replacing React, Vite, Tailwind, shadcn/ui, Recharts, or Supabase.
- Any generative model producing outcomes, narratives, or numbers.
- Migration to a different mapping/physics/DSL framework. The BN is ~20 nodes; hand-written variable elimination and a hand-written DE are appropriate and auditable at this size. Reach for pgmpy only in the offline Python fitting step.
- Model interpretability theatre: SHAP values over a black box would be a step backwards. The BN's structure *is* the explanation.
- Claiming predictive accuracy. The paper already correctly disclaims this; keep that disclaimer.

---

## 15. Open decisions to record before M1

1. **Literacy definition** — 76.89% vs 86.65%. Resolve against the primary Census 2011 PDF and record the definition used.
2. **Ward → zone mapping** — real ward geography, or population-balanced assignment? Prefer real if ward boundaries can be sourced; otherwise state the assumption.
3. **Tier B source records** — regenerate the 2,500-town corpus with the same consistency-enforcing generator, or leave it labelled as illustrative? Regenerating is the stronger answer if time permits.
4. **Jev access** — obtain early access or gateway credentials, or ship with `RuleDecisionEngine` + `LlmDecisionEngine` and document Jev as the intended production decision layer? The latter is a complete, defensible system; Jev is an upgrade, not a dependency.
5. **Objective weights** — default weights for the scalar fitness, and whether the default UI mode is scalar or Pareto. Prefer Pareto as the default: it surfaces the trade-off instead of hiding it.
6. **Simulation granularity** — this spec specifies an open-loop, cross-sectional run (attributes → outcomes for one policy vector). Consider whether a multi-period, feedback variant (outcomes at t feed the state at t+1) is in scope; the BN as specified is acyclic and evaluates one period at a time. If multi-period is wanted, the honest design is a stacked/rolled network per period, with the agent state carried forward — say so explicitly rather than pretending one acyclic query is a dynamic simulation.

---

## 16. As-built record

This section records what was actually implemented, where it deviates from §13, and what
remains. It is written to be checked, not believed: every claim below is enforced by a test in
`src/simulation/__tests__/engine.test.ts` or by an assertion inside the engine.

### 16.1 Where the code lives (deviation from §5.2, and why)

§5.2 planned `engine/ts`, `engine/py` and a frozen JSONL artifact, with the heavy path in a
Supabase Edge Function (§10.3). What exists is a single TypeScript engine under
`src/simulation/`, running in the app, with no Python step and no Edge Function:

| Spec | As built | Why |
|---|---|---|
| `engine/ts/*` | `src/simulation/*` | One package, already on the Vite/TS path; no second toolchain to keep in sync. |
| `engine/py/generate_population.py` → `agents.jsonl` | `population.ts` generating the population **in memory**, deterministically, from a seed | A 98,923-row JSONL of derived data is not data — it is the output of this function. Shipping the generator means there is exactly one source of truth, the file cannot drift from the code, and the manifest hash makes any run reproducible. Export to JSONL remains a one-line addition if an artifact is required. |
| `supabase/functions/simulate` + the `simulations` migration | **Not built** | No Supabase project is configured in this workspace, so persistence could not be verified end to end, and shipping an unverified write path would be worse than not shipping one. The Lab exports a run as JSON instead. This is the largest remaining gap and it blocks nothing in the engine. |

Consequence to state plainly in the paper: the Simulation Lab currently executes in the browser.
The engine is pure and deterministic, so moving it behind an Edge Function is a port, not a
rewrite — but until that is done, the deployed app does not use the `profiles` / `simulations` /
`saved_reports` tables for simulation runs.

### 16.2 Milestone status

| Milestone | Status | Evidence |
|---|---|---|
| M0 contracts, provenance ledger | Done | `types.ts`, `census.ts` `FIELD_LEDGER` (20 fields tagged), ward → zone map (33 wards) |
| M1 synthetic population | Done | `population.ts` — one agent per real citizen; `validatePopulation` asserts the Census totals |
| M2 Bayesian network | Done | `bn.ts` — 29 nodes, CPTs counted from the population where observable and documented priors elsewhere, `do`-calculus by graph mutilation (`withIntervention`), posterior marginals by ancestral sampling, causal attribution by mutual information |
| M3 aggregation and identities | Done | `aggregate.ts` — `checkIdentities` / `assertIdentities`, enforced on every period of every run |
| M4 Differential Evolution | Done | `de.ts` — DE/rand/1/bin with NSGA-II non-dominated sort + crowding, plus a random-search control |
| M5 decision layer | Done | `decision.ts` — rule (default), Jev, schema-constrained LLM adapters behind one interface, with recorded fallback |
| M6 persistence + Edge Function | **Not done** | see 16.1 |
| M6 UI (Simulation Lab) | Done | `src/pages/SimulationLab.tsx`, rebuilt against the engine; no `mockData` import remains on this page |
| M7 task-exposure layer | Done | `SECTOR_TASK_EXPOSURE` → per-agent `taskExposure` → `ScenarioExposure` node; Modest / Substantial / Extreme presets |

### 16.3 Open decisions (§15), as resolved

1. **Literacy definition** — the effective figures (M 81.11% / F 72.45%) are used; the crude
   variant is retained in `CENSUS.literacyCrudeReportedAlt` so the discrepancy is visible in the
   code rather than resolved silently. Still to do: confirm against the primary Census PDF.
2. **Ward → zone mapping** — population-balanced contiguous ranges, tagged `estimated` in the
   ledger. Not real geography, and labelled as such everywhere it appears.
3. **Tier B corpus** — not regenerated. The flagship tier (a real town, every real citizen) is
   complete; the illustrative 2,500-town corpus is untouched and still labelled illustrative.
4. **Jev** — shipped as an adapter with the rule table as the default and recorded fallback. The
   system is complete without Jev; Jev is an upgrade.
5. **Objective weights** — Pareto by default. The Lab reports the non-dominated front and also
   warns when an equal-budget random search matches DE on the landscape, rather than assuming the
   search paid off.
6. **Simulation granularity** — **resolved in favour of multi-period**, rolled rather than made
   acyclic: the network is evaluated once per period and the resulting outcome distribution is
   written back into agent state (employment, savings stock, sentiment, trust, migration intent,
   skill relevance). Channel lags (`CHANNEL_LAGS_MONTHS`) differ per instrument so the curves do
   not move in lock-step, and each period re-runs the accounting identities. Baseline and policy
   runs roll identically, and the reported GDP growth is defined against that baseline rather than
   against a hardcoded series.

### 16.4 A real defect found during implementation (and fixed)

The first passing build reported a nearly inert policy response: a high-budget subsidy moved
P(high inflation) only 22.0% → 24.8%, and income and spending capacity did not respond to policy
at all. The cause was a silent mismatch between each node's declared parents and the policy
dimensions its shift actually reads. `IncomeClass`, `SpendingCapacity` and `PublicSentiment` did
not condition on `PolicyType` at all, and `Inflation` did not condition on `PolicyIntensity`, so
`policyLogShift` saw `undefined` and fell through to the weakest scale — meaning a subsidy's
documented income channel never fired, and the chained causality the paper argues for (§5) was
severed at its first link.

The fix makes the parent set derive from the shift's declared dimensions (`POLICY_SHIFT_DIMS`),
so the two can never disagree again, and makes an unspecified dimension fall back to the medium
reference scale rather than the minimum. The same check now reads 23.8% → 41.0%.

This is worth reporting as a methodology point: the direction check in §6.6 is what caught it. A
weaker assertion ("the number changed") would have passed.

### 16.5 Verifiable claims

`bun run test` — 25 tests, all passing:

- the generated population reproduces byte-for-byte for the same seed, differs for another, and
  satisfies every Census consistency assertion;
- a full run is byte-identical for identical inputs and seed;
- every accounting identity holds on every period of several randomised policies;
- the network's documented directions hold for subsidy, housing, migration and education;
- the DE search converges, reports a non-dominated front, and is compared against random search;
- zone incidence, intervals, trajectories, alerts, guardrails and the evidence pack are all
  produced by the same code path that produced the headline numbers.

### 16.6 What remains, in priority order

1. **Persistence** (§10.4 + the Edge Function). Until this exists, runs are exported as JSON.
2. **Landing-page and dashboard honesty.** `Dashboard`, `Alerts`, `DataIntelligence` and
   `SavedReports` still render `src/lib/mockData.ts`. The Simulation Lab no longer does. Those
   four pages should either be fed by real runs or carry a visible "illustrative" label — the
   current state invites exactly the criticism the evaluation already made.
3. **Tier B regeneration** with the same consistency-enforcing generator.
4. **Literacy audit** against the primary Census PDF.
5. **Calibration.** The CPTs are counted from a synthetic population whose income and sector
   fields are modelled, so the *directions* are defensible and the *magnitudes* are not yet.
   Anchoring income and sector to NSSO or District Census Handbook tables is what would make the
   magnitudes claimable.
