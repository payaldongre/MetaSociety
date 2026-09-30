# A brief description about the project
- We start by uploading real-world town data into the system.

- The platform analyzes this data and presents it through interactive dashboards and simple insights, making it easy to understand the current situation.

- Next, using the AI Policy Advisor, users can define their goals — for example, reducing unemployment or improving economic growth.

- Based on this, the system suggests suitable policies along with expected outcomes and risks.

- These policies can then be tested in the Simulation Lab, where a virtual town with AI citizens reacts realistically to each decision.

- The platform then shows the economic and social impact, including key metrics, risk alerts, and comparisons between different scenarios.

- This allows policymakers to evaluate decisions before implementing them in the real world.

- All simulation results are stored securely, ensuring reliability and future analysis.

- Meta Society transforms policymaking from guesswork into a data-driven and predictive process.

- Instead of experimenting on real people, we experiment on a virtual society first.
-----------------------------------------------------------------------------------------------------------------------------------------

## Simulation Lab engine

The Simulation Lab is a **decisive** engine, not a generative one. Every number it reports is a
deterministic function of `(population, policy vector, engine version, seed)`. No language model
produces an outcome, a magnitude, or a chart series.

- **Agent = a person**, living in a household, in a ward, in a zone, in a town. It is never a town,
  never a zone, and never a "representative citizen".
- **Population** — one agent per real citizen of Pandharpur (Solapur, Maharashtra), generated
  from published Census 2011 totals so the published figures match exactly (population, sex split,
  households, children 0–6, SC/ST share, literacy by gender and worker counts by gender). The
  Census fields are verified; income, sector, education and housing are modelled, and
  `src/simulation/census.ts` states which is which field by field.
- **Bayesian network** — 29 nodes, with conditional probability tables counted from the population
  wherever a node is observable, and documented priors elsewhere. Interventions use `do(...)` by
  graph mutilation, so a policy effect is causal rather than a conditional read.
- **Multi-period** — the network is rolled one period at a time with agent state carried forward
  (employment, savings stock, sentiment, trust, migration intent, skills), and each instrument has
  its own channel lag so the trajectory does not move in lock-step.
- **Counterfactual baseline** — the no-policy path is produced by the same engine on the same
  population, so a result always ships with its own comparison instead of a hardcoded series.
- **Zone incidence** — East / West / North / South are a partition of all 33 wards reported *after*
  the run, so the output can be "town-wide +6%, but North +11% and East +1.2%".
- **Policy search** — Differential Evolution (with NSGA-II non-dominated sorting) searches
  intensity, budget, duration and allocation, scored by the network, and reports the Pareto front
  together with an equal-budget random-search control.
- **Decision layer** — a "System One"-style adapter (rule table by default; Jev or a
  schema-constrained LLM when configured) answers *typed* questions at period boundaries
  (`Choose` / `Score` / `Noul`). It is never the source of a displayed number, and it records when
  it had to fall back.
- **Accounting identities** — headline metrics are summations over the agent population, and the
  identities are asserted on every period of every run. A run that does not balance fails loudly.
- **Evidence pack** — each run re-checks the Census totals, the network's documented response
  directions, the identities and reproducibility, and reports exactly which checks passed.

```bash
bun run test     # 39 tests: population, network directions, identities, determinism, search, zones
                 # two vitest projects (app / simulation) — see vitest.config.ts; the engine suite is CPU-heavy
bun run dev      # app; the Simulation Lab page renders engine output, not mock data
```

The full specification, the reasoning behind each decision, and the verified-data build spec are
in [`SIMULATION_LAB_SPEC.md`](./SIMULATION_LAB_SPEC.md). The engine's acceptance tests live in
`src/simulation/__tests__/engine.test.ts`, with the build spec's definition-of-done checks in
`src/simulation/__tests__/spec-dod.test.ts`. Real town datasets come from `src/lib/townData.ts`.
Saved runs persist to the browser store (and to Supabase when it is configured) via
`src/lib/runStore.ts`; the Dashboard, Data Intelligence, Alerts and Saved Reports pages read real
engine/population data, not mock samples.
