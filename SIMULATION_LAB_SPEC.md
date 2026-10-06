# Meta Society — Simulation Lab: Verified Data & Complete Build Spec

**Purpose of this document:** a self-contained spec an engineering agent (human or AI) can implement against. It supersedes the earlier `data-and-simulation-enhancements.md` draft — that draft's claims have been verified against real data below, one design principle has been made explicit (**Simulation Lab must be decisive, not generative**), and two new sections translate outside research into concrete build guidance.

**Out of scope:** the AI Policy Advisor (`supabase/functions/policy-advisor`, Groq/LLaMA 3.1, LangGraph) is complete, working, and **not touched by this plan**. Everything below is Simulation Lab + its supporting data/model layer only.

---

## 0. Core design principle: decisive, not generative

This is the single most important constraint for whoever builds this, so it is stated first, plainly:

> **The Simulation Lab must never call an LLM to produce its outcome numbers.** No GPT/Groq/Claude call should sit anywhere in the path from "policy submitted" to "GDP/employment/happiness/protest-risk number shown to the user." An LLM can be used *upstream* (the existing Policy Advisor, suggesting what to try) or *downstream* (writing a plain-English caption around a number that a model already computed) — never *in the loop* that produces the number itself.

Why this matters enough to state as a rule: an LLM asked "if we cut this subsidy, what happens to employment?" will produce a fluent, plausible-sounding number that is not derived from anything — it is pattern-completion, not computation. That is indistinguishable, to a policymaker, from a real forecast, which is worse than an admittedly-fabricated placeholder, because it *looks* trustworthy. Everything in Sections 3–5 below (behavioral profiles, Bayesian Network, Evolutionary Algorithm) exists specifically to give the Simulation Lab numbers that come from an actual, inspectable model instead.

---

## 1. Verified: the new dataset fixes the two real problems with the old one

The old CSVs (`economy.csv`, `demographics.csv`, etc.) were checked previously and confirmed structurally invalid — e.g., in under 6% of rows did age brackets or gender counts actually sum to the stated total population. That data should be **retired**, not patched.

A new file, `pandharpur_synthetic_population.csv`, was provided as its replacement. **It has been independently verified against its own documentation by direct computation — not just read and trusted:**

| Claim in the enhancement plan | Computed from the actual CSV | Verdict |
|---|---|---|
| Total population 98,923 (M 50,645 · F 48,278) | 98,923 rows; M 50,645 · F 48,278 | ✅ exact match |
| Households: 20,054 | 20,054 unique `household_id` values | ✅ exact match |
| Effective literacy: Male 81.11% · Female 72.45% | Male 81.11% · Female 72.45% (computed on population aged 7+, matching the Census "effective literacy" definition, which excludes ages 0–6) | ✅ exact match |
| Total workers 30,855 (M 25,162 · F 5,693) | 30,855 workers; M 25,162 · F 5,693 | ✅ exact match |
| Wards: 33 | 33 unique ward values | ✅ exact match |
| SC 12.34% / ST 5.47% | SC 12.31% / ST 5.61% | ✅ close (small sampling variance, <0.2 points — not a concern) |
| Literacy rises with income among workers (72.7% low → 88.8% high) | low 72.7%, lower-mid 80.5%, upper-mid 85.7%, high 88.8% | ✅ exact match, and monotonic as claimed |
| Literate people ~2× as likely to work as illiterate (36.9% vs 18.9%) | 36.9% vs 18.9% | ✅ exact match |

**Conclusion: the new dataset's claims are accurate, not just asserted.** It is one real town (Pandharpur, Maharashtra), 98,923 individual synthetic citizens, each with `household_id`, `ward` (1–33), `gender`, `age_band`, `caste_category`, `literate`, `is_worker`, `sector`, `income_class` — internally consistent by construction, and large enough on its own (98,923 > 80,000) to satisfy the evaluators' scale concern **for the right reason**: it's one town modeled at individual-citizen granularity, not thousands of towns averaged into meaninglessness.

**Action:** treat `economy.csv`/`demographics.csv`/etc. (the old 2,500-town files) as retired for anything agent/simulation-related. They may still be reused, cautiously, for the AI Policy Advisor's cross-town dashboard narrative if desired — that's outside this plan's scope — but no new modeling work should be built on them.

**One caveat to build in, not paper over:** `income_class` and `sector` are *not* Census fields — no census records a citizen's income bracket or industry sector directly. The generator assigned these as a *modeled* layer on top of the real Census anchors (population, gender, literacy, worker counts, households, wards). This is a legitimate and standard microsimulation technique, but the system should never present `income_class` or `sector` to a user as "real Census data" — only population totals, gender split, literacy, worker counts, and ward count carry that claim. Carry this distinction into any UI copy or report that cites the data ("grounded in Census 2011 totals, with income and sector modeled from town-level economic indicators").

> **As built.** The population is generated in memory (`src/simulation/population.ts`) from the published Census 2011 totals rather than shipped as a CSV artifact, so the verified totals cannot drift from the code, and `validatePopulation` asserts each one exactly. `src/simulation/census.ts` carries the field-level provenance ledger (`FIELD_LEDGER`) that the Simulation Lab renders directly; income and sector are tagged `modelled`.

---

## 2. Verified: the clustering critique is real, and the fix is now buildable

The old approach — k-means into 10 clusters, one representative agent per cluster, feeding a Random Forest — was already identified as a problem in an earlier planning pass (insufficient labeled data, black-box, no causal chain). The new dataset adds a concrete, checkable reason it was *also* the wrong grouping mechanism: computing `income_class × is_worker × sector` combinations against the real data yields **26 real combinations**, and crossed with 33 wards, up to a few hundred behaviorally distinct cells exist with actual citizens in them — nowhere near reducible to 10 without destroying most of the real variation the data now contains.

**Revised profile definition** (replaces k-means entirely):

```
profile = (income_class, is_worker, sector, ward)
```

This is not arbitrary — every one of these four fields is a citizen attribute known, from the domain, to plausibly change how someone reacts to a given policy (a subsidy lands differently on a low-income informal-sector worker in one ward than a salaried government worker in another). That is the exact property k-means centroids lacked: a defensible, nameable reason two agents are grouped together or apart.

> **As built.** Profiles are never materialized as a separate structure; the engine keeps one agent per citizen and treats `(incomeClass, workerStatus, sector, ward)` as the addressing key when it needs a cell. The acceptance test asserts the population supports more than 100 populated cells (not 10) and that no citizen is silently dropped.

---

## 3. The Bayesian Network (per-profile, not per-citizen)

Design carried over from the prior planning pass, now anchored to real data:

```
Policy (type, budget, duration)
   ↓
Agent income class → Agent employment status → Spending behavior
   ↓                          ↓
Sector demand              Inflation
   ↓                          ↓
GDP growth ←───────── Public sentiment (happiness) → Protest / riot risk
```

- **Runs once per behavioral profile** (Section 2), not once per citizen. With on the order of a few hundred profiles, this stays computationally cheap while still being far more granular than 10 clusters.
- **CPTs (conditional probability tables)** are fit from the citizen-level data aggregated within each profile — e.g., a profile's baseline employment rate, literacy rate, and worker share come directly from the real citizens assigned to it.
- **Tooling:** `pgmpy` (Python), living in `backend/agent_simulation/network.py`.
- **Town-level output** = a weighted aggregation of all profile-level outputs, weighted by how many real citizens fall into each profile — so a profile covering 8,000 citizens correctly outweighs one covering 80.
- **This stage is what makes the Simulation Lab decisive rather than generative** (Section 0): its output is a probability distribution over an outcome, computed by graph inference from real conditional probabilities, not sampled from a language model's sense of what sounds plausible.

> **As built.** Implemented in TypeScript, not Python: `src/simulation/bn.ts` (29 nodes). CPTs are counted directly from the population for every node whose parents are observable, with documented priors only for the genuinely unobservable ones (latent demand, sector output, the aggregate bands, and the policy parameters themselves). Every table records its provenance. Interventions use `do(...)` by graph mutilation (`withIntervention`), so a policy effect is causal rather than a conditional read. A microservice split is not required to satisfy this section; the acceptance checks are what matter, and they live in `src/simulation/__tests__/engine.test.ts`.

---

## 4. The Evolutionary Algorithm (policy search)

Also carried over, unchanged in design, now made concrete: given the Bayesian Network above as a scoring function, a Differential Evolution search explores the continuous policy-parameter space (tax rate, subsidy amount, budget split across housing/education, duration) to find configurations that outperform whatever the LLM-based Policy Advisor suggested as a starting point — including combinations neither an LLM nor a human would think to try. Where policy goals conflict (lower unemployment vs. contain inflation), extend to a multi-objective search (NSGA-II) and surface a **Pareto front** rather than one number, so the policymaker chooses their own trade-off instead of the algorithm silently picking one for them.

**Tooling:** `scipy.optimize.differential_evolution` for a first pass, or a custom DE/GA loop if multi-objective support is needed sooner; living in `backend/agent_simulation/optimizer.py`.

> **As built.** `src/simulation/de.ts` — DE/rand/1/bin with dithering and Latin-hypercube initialisation, NSGA-II-style non-dominated sort plus crowding distance for the multi-objective case, and an equal-budget random-search control reported alongside it so the paper can say whether the search actually paid off. The search tier uses a reduced agent sample and coarser periods; it is the only approximation in the system and the UI labels it as such.

---

## 5. New: designing the Simulation Lab's UX like Anthropic's Economic Scenario Explorer

You referenced Anthropic's [*Scenarios for our Economic Future*](https://www.anthropic.com/institute/econ-scenarios) — a real, currently-live interactive model (technical report: *Economic Scenarios for Transformative AI*, Korinek et al., 2026) projecting how AI could reshape US GDP, employment, and wages by 2030. It is genuinely a strong template for this project, for reasons specific enough to build against, not just "make it interactive too":

### 5.1 What it actually does, and the direct translation to Simulation Lab

| Anthropic's Econ Scenario Explorer | Direct translation for Meta Society's Simulation Lab |
|---|---|
| Decomposes *every job* into a bundle of **tasks**, each independently tagged as unchanged / augmented / automated / newly-created by AI | Decompose *every policy's effect* on a behavioral profile (Section 2) into tagged channels: **unaffected** / **directly affected** (the policy's stated target) / **spillover-affected** (an indirect knock-on, e.g. inflation from someone else's subsidy) / **newly-emergent** (an unintended second-order effect, e.g. informal-sector migration). Showing this breakdown, not just a final number, is what makes a prediction legible instead of a black box. |
| Presents **three labeled scenario tiers** (modest / substantial / extreme) as fixed reference points before letting the user set their own parameters | Give the Simulation Lab three **preset intensity tiers** per policy (e.g. Conservative / Moderate / Aggressive rollout), each pre-filled with sensible budget/duration values, before exposing the raw sliders — most users benefit from anchoring on a labeled example before tweaking numbers themselves |
| Interactive sliders (capabilities, adoption, autonomy, productivity, adjustment-time) that combine into a computed outcome, shown against a survey of 10,000+ other people's assumptions | The existing budget/duration/policy-type controls *are* this already — the addition worth making is showing the **Bayesian Network's confidence interval**, not just a point estimate, exactly as their GDP/wage charts show a spread across scenarios rather than one line |
| A hard separation between "**what AI is doing right now**" (their Economic Index, a separate product) and "**what AI might do by 2030**" (this scenario explorer) | Mirrors the project's own existing split: the **AI Policy Advisor** (current-state insight + suggestion, already built) vs. the **Simulation Lab** (forward-looking scenario modeling, this plan) — worth stating this parallel explicitly in the product's own docs, since it's a clean, evaluator-legible framing already earned by the current architecture |
| A long, candid, specifically-worded **limitations section** at the end (named economist reviewers, explicit list of what the model excludes, "the model isn't a complete map of reality") | Build a permanent, visible **"Model Limitations" panel** into the Simulation Lab UI itself (not a buried README) — e.g. "assumes no external economic shocks," "income and sector are modeled, not Census-measured, see §1," "does not model migration between towns." This is not boilerplate CYA — it is the single detail most likely to make a technical evaluator trust the rest of the model, precisely because Anthropic's own team treats it as worth this much space rather than a footnote. |

### 5.2 What is *not* a fair translation

One thing evaluators or teammates may push to imitate that shouldn't be: Anthropic's model is backed by a peer-reviewed technical report with named external economist reviewers and a national survey of 10,000+ respondents. Meta Society's Bayesian Network is not at that evidentiary bar and should never be presented as if it were — the honest framing is "a structured, inspectable model calibrated against real Census-anchored data for one pilot town," which is a legitimate and defensible claim on its own, without borrowing credibility that belongs to a much larger research effort.

> **As built.** The AI economic scenario presets (Modest / Substantial / Extreme) have been deleted — no selector, and no lever reaches the engine; every headline metric is reported as a probability-style aggregate over a fixed internal 12-round seed ensemble ("X% probability this policy improves the metric; median effect; 90% interval"), not a decorated point estimate; every number carries a provenance tag via the Data & provenance tab; and the permanent **Model Limitations** panel renders on the Simulation Lab with named, specific limitations. The "Where this policy lands" panel classifies each metric as directly affected, spillover, or unaffected from the run's own deltas, and lists the engine's warnings as the newly-emergent second-order effects.

---

## 6. New: JEPA (not "JEV") — what it is, and how it actually applies here

The concept you're recalling is almost certainly **JEPA — Joint-Embedding Predictive Architecture**, proposed by Yann LeCun (Meta AI) in 2022. ("JEV" isn't a recognized term in this space; JEPA fits everything you described.) It's real, current, and directly relevant to the "decisive, not generative" principle in Section 0 — worth explaining properly rather than name-dropping.

### 6.1 What JEPA actually is

Most AI models you've used so far are **generative**: given some input, they produce output *in the same space as the input* — an LLM predicts the next token (text out from text in), a diffusion model predicts pixels (image out from noise in). JEPA is built on a different premise: instead of reconstructing raw output, it predicts the **latent embedding** (an internal, compressed representation) of what comes next, given the embedding of what it has now. It never generates text or pixels at all — it only ever predicts "what abstract state plausibly follows this one," which is exactly the "System 1 vs. System 2" framing you heard: several papers on JEPA explicitly describe it as combining a fast, intuitive latent-space predictor with a slower, deliberate planning layer built on top of it, rather than everything running through one generative pass.

This is why it's positioned for **decision-making and planning** rather than content creation: a robot using a JEPA-style world model doesn't "imagine a picture" of the room after it moves an object — it predicts the *embedding* of that future state directly, then a planning layer searches over possible actions by comparing predicted embeddings against a goal embedding, and picks whichever action's predicted future is closest to the goal. Nothing is ever generated in the human-readable sense; everything stays in representation space until a final decision is read out.

### 6.2 Why literal JEPA doesn't drop into this project as-is

JEPA (and its published variants — I-JEPA for images, V-JEPA for video) is built and validated for **perceptual, high-dimensional data** (video frames, images) with large unlabeled datasets and self-supervised training. Meta Society's Simulation Lab problem is low-dimensional, tabular, and — even after Section 1's fix — has nowhere near the data volume JEPA-style self-supervised pretraining assumes. Recommending "swap in a JEPA" as a literal implementation step would be a mismatch of tool to problem at this project's current scale, and should be named as such rather than glossed over.

### 6.3 What *is* a fair and useful translation

The **principle**, not the specific architecture, is exactly what Section 0 already commits this project to:

- **Predict a state, don't generate text.** The Bayesian Network (Section 3) already does the JEPA-aligned thing: given a "current town state + policy" input, it predicts a distribution over the *next state's key variables* directly — it never passes through anything resembling free-text generation on the way to that number. This is worth stating explicitly in any write-up: *"the Simulation Lab already follows JEPA's core principle — predicting structured future state directly, rather than generating a plausible-sounding description of one — implemented here via a Bayesian Network rather than a learned embedding space, because the data scale doesn't yet warrant a learned world model."*
- **A genuine future-work stretch goal, correctly scoped:** once the Bayesian Network + Evolutionary Algorithm pipeline has run enough times (each run is one "rollout": a policy in, a predicted outcome out), those rollouts *are* a training set. At that point, training a small learned model to predict outcome embeddings directly from policy + town-state embeddings — skipping explicit BN inference for speed — is a legitimate, appropriately-scaled nod to the JEPA principle: not "add JEPA," but "once the BN has generated enough of its own rollouts, distill it into a faster learned predictor, in the same non-generative, predict-the-state-not-the-text spirit JEPA argues for." Flag this in any roadmap as **Phase 2, post-launch**, not a day-one dependency.

---

## 7. Complete implementation roadmap

| Phase | Task | Depends on |
|---|---|---|
| 1 | Retire `economy.csv`/`demographics.csv`/etc. for simulation purposes; adopt `pandharpur_synthetic_population.csv` as the citizen-level source of truth | — (done: dataset verified in Section 1) |
| 2 | Build the behavioral-profile assignment (`income_class × is_worker × sector × ward`) replacing k-means entirely | Phase 1 |
| 3 | Fit per-profile statistics (baseline employment, literacy, worker share, population weight) from the citizen data | Phase 2 |
| 4 | Design the Bayesian Network structure (Section 3) and estimate CPTs per profile using `pgmpy` | Phase 3 |
| 5 | Validate the network against known directional relationships (e.g. does a subsidy increase must-improve probability) before trusting it for anything user-facing | Phase 4 |
| 6 | Implement the Differential Evolution optimizer (Section 4) using the validated network as its fitness function | Phase 5 |
| 7 | Stand up a Python microservice (or extend `backend/agent_simulation/`) exposing BN inference + EA search, alongside the existing Groq-based Policy Advisor service | Phase 6 |
| 8 | Rebuild the Simulation Lab frontend: scenario-tier presets, task/channel breakdown display, confidence intervals not point estimates, and a permanent Model Limitations panel (Section 5) | Phase 7 |
| 9 | Replace `SimulationLab.tsx`'s hardcoded `setTimeout()` mock with real calls to the Phase 7 service; populate `results`/`effectiveness_score` in the `simulations` table with real computed values | Phase 8 |
| 10 | *(Post-launch stretch, not required for initial completion)* — once enough BN/EA rollouts exist, prototype a small learned predictor over them as a JEPA-principle-aligned speed optimization (Section 6.3) | Phase 9, plus accumulated rollout data |

### Definition of done, per phase (what an agent should check before calling a phase complete)

- **Phase 1–3:** running a script over `pandharpur_synthetic_population.csv` produces a table of profiles, each with a population count that sums back to 98,923 and no profile silently dropped.
- **Phase 4–5:** for at least three hand-picked test policies with an intuitively obvious expected direction (e.g., "large unconditional cash subsidy" should predict *higher* modeled spending), the network's output moves in that direction — documented as a short validation note, not just asserted.
- **Phase 6:** the optimizer, run against the validated network, returns policies that score at least as well as the Policy Advisor's own suggestions on the same fitness function, on at least one test goal.
- **Phase 7–9:** a user can submit a policy in the running app and see a number that changes when the network's underlying CPTs change (proving the number is actually wired to the model, not still hardcoded) — this is the concrete, testable version of Section 0's "decisive, not generative" requirement.

---

## 8. Summary of what changed from the earlier draft

- Verified the new dataset's specific numeric claims by direct computation, not by trusting the accompanying documentation — all check out, with one clarified caveat (`income_class`/`sector` are modeled, not Census-measured).
- Made explicit, as a named non-negotiable constraint, that the Simulation Lab must never route its outcome numbers through an LLM — this was implicit in the original plan's "no more fabricated numbers" goal but is now stated as a hard rule with a rationale, so it can't quietly regress if an LLM later "seems like an easy way to fill in a gap."
- Added Section 5, translating Anthropic's Economic Scenario Explorer into specific, buildable UX guidance rather than a general inspiration reference.
- Added Section 6, correcting "JEV" to JEPA, explaining what it actually is, being honest that it doesn't plug in directly at this project's current scale, and scoping a specific, appropriately-sized future-work item instead of overclaiming it as a current-phase dependency.

---

## 9. As-built record (this repository)

This section records what is implemented against the phases above, and what remains. It is written to be checked, not believed: every claim is enforced by a test in `src/simulation/__tests__/engine.test.ts` or by an assertion inside the engine.

### 9.1 Where the code lives

| Spec | As built |
|---|---|
| `pandharpur_synthetic_population.csv` as a file artifact | Generated in memory, deterministically, from the published Census 2011 totals (`src/simulation/population.ts`), with the verified figures asserted on every run. No 98,923-row artifact to drift from the code; `population.manifest` hashes the generation inputs. |
| `pgmpy` Python Bayesian network (`backend/agent_simulation/network.py`) | `src/simulation/bn.ts` — a 29-node discrete DAG with a hand-written exact-inference path. CPTs counted from the population where observable; documented priors only where not. |
| `scipy` / custom DE (`backend/agent_simulation/optimizer.py`) | `src/simulation/de.ts` — DE/rand/1/bin + NSGA-II non-dominated sort + crowding distance, with a random-search control. |
| `supabase/functions/simulate` + the `simulations` migration | Not built as an Edge Function. The engine runs in the browser; persistence is `src/lib/runStore.ts` (browser store always; Supabase insert when `VITE_SUPABASE_URL`/`VITE_SUPABASE_PUBLISHABLE_KEY` are set and a user id is available). This workspace has no Supabase project configured, so the remote path is present but not verifiable end to end — stated rather than implied. |

### 9.2 Milestone status

| Phase | Status | Evidence |
|---|---|---|
| 1–3 Citizen-level population, profile cells | Done | `population.ts`; the suite asserts 98,923 agents, exact Census totals, >100 populated `(incomeClass, workerStatus, sector, ward)` cells, and no dropped citizen. |
| 4 Bayesian network | Done | `bn.ts` — 29 nodes, `do(...)` by graph mutilation, posterior marginals by ancestral sampling, causal attribution by mutual information. |
| 5 Direction validation | Done | `validateBnDirection` is run on every run and its checks appear in the evidence pack; the suite asserts every documented direction holds with no failures. |
| 6 Differential Evolution | Done | `de.ts`; the suite asserts convergence toward a known optimum, seed determinism, a correct non-dominated front, and a random-search control. |
| 7 Service boundary | Not built (browser engine instead) | The engine is pure, so moving it behind a service is a port, not a rewrite. |
| 8 Frontend UX (§5) | Done | `src/pages/SimulationLab.tsx` — scenario tiers, 90% credible intervals, provenance rail, "Where this policy lands" channel breakdown, permanent Model Limitations panel. |
| 9 Real numbers, no mock, persistence | Done | The Lab renders engine output only; Save writes real computed `effectiveness_score`/metrics through `runStore.ts`; grep for `mockData` in `src/pages` is clean. |
| 10 Learned predictor (JEPA principle) | Not started | Deliberately post-launch; requires accumulated rollouts. |

### 9.3 Accounting identities and reproducibility

Headline metrics are summations over the agent population and the stated identities are asserted on every period of every full-population run (`aggregate.ts`, `simulate.ts`). A run that does not balance throws `AccountingViolationError`. A result is a deterministic function of `(population, policy vector, engine version, seed)`; the suite runs the same request twice and asserts the point metrics, baseline and trajectories are identical.

### 9.4 What remains, in priority order

1. **Supabase persistence verified end to end.** Provide `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` and a real authenticated user id; write the `simulations` migration with RLS by `user_id`; confirm insert/read from the browser. The client path in `runStore.ts` is ready for it.
2. **Calibration of magnitudes.** CPTs are counted from a synthetic population whose income and sector fields are modelled, so the *directions* are defensible and the *magnitudes* are not yet claimable. Anchoring income and sector to NSSO or District Census Handbook tables is the work that would change that.
3. **Literacy audit** against the primary Census 2011 PDF (effective vs crude definition — the alternative is retained in `census.ts` so the discrepancy stays visible).
4. **Ward → zone mapping** replaced with sourced ward geography (currently population-balanced contiguous ranges, tagged `estimated`).
5. **A learned predictor over accumulated rollouts**, in the non-generative spirit of Section 6.3.
