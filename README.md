# A brief description about the project
- We start with a synthetic population anchored to Census 2011 totals for Pandharpur, generated field by field.

- The platform analyzes this population and the town datasets and presents them through interactive dashboards and simple insights, making it easy to understand the current situation.

- Next, using the AI Policy Advisor, users can define their goals — for example, reducing unemployment or improving economic growth.

- Based on this, the system suggests suitable policies along with expected outcomes and risks.

- These policies can then be tested in the Simulation Lab, where a virtual town of agent-citizens responds to each decision. Response directions are checked on every run; **magnitudes are not yet calibrated** against an evaluated real programme.

- The platform then shows the economic and social impact, including key metrics, risk alerts, and comparisons between different scenarios.

- This allows policymakers to explore the direction of a decision before implementing it in the real world. It is a **directional scenario comparison tool, not a forecasting service**.

- All simulation results are stored securely, ensuring reliability and future analysis.

- Meta Society turns policy exploration into a data-driven, inspectable scenario comparison rather than guesswork.

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
- **Bayesian network** — 30 nodes (derived from `NODE_REGISTRY`, not hardcoded; a test pins the count so the docs
  cannot drift), with conditional probability tables counted from the population
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
- **Policy brief is the authoritative input** — a policy is a structured brief (objective,
  problem statement, governing authorities, targeted population, budget line items, implementation
  timeline), not three sliders. Governance competence, budget (line items must equal the stated
  total exactly) and timeline feasibility are validated, and the gate is **enforced in the engine
  itself**: `runSimulation` re-runs `validatePolicyBrief` and throws `PolicyFeasibilityError`, so a
  blocked policy cannot be simulated even if the UI is bypassed. The ₹200M simulation safety limit
  is labelled a *model assumption*, never a statutory ceiling.
- **Historical validation (backtest)** — documented Pandharpur cases are replayed through this same
  engine from pre-policy information only and compared with the observed outcome. Each case reports
  an honest status — supported / partially supported / directionally consistent / inconclusive /
  not representable / insufficient evidence — and a direction-only agreement is never presented as
  an accurate prediction. A case the engine cannot represent says so rather than inventing one.
- **Honest uncertainty wording** — the seed ensemble is reported as an empirical *share of simulated
  seed runs* and an *empirical seed interval*, never as a probability, confidence level or
  calibrated likelihood.

```bash
bun run test     # 135 tests: population, network directions, identities, determinism, search, zones,
                 # policy-brief/governance gating, Wari seasonality, engine-backed backtesting,
                 # spec definition-of-done, and page/persistence wiring
                 # two vitest projects (app / simulation) — see vitest.config.ts; the engine suite is CPU-heavy
bun run dev      # app; the Simulation Lab page renders engine output, not mock data
```

The full specification, the reasoning behind each decision, and the verified-data build spec are
in [`SIMULATION_LAB_SPEC.md`](./SIMULATION_LAB_SPEC.md). The engine's acceptance tests live in
`src/simulation/__tests__/engine.test.ts`, with the build spec's definition-of-done checks in
`src/simulation/__tests__/spec-dod.test.ts` and the de-mocked page/persistence wiring checks in
`src/test/dataWiring.test.ts`. Real town datasets come from `src/lib/townData.ts`. The canonical
population (the in-memory generator) and its relation to the `pandharpur_synthetic_population.csv`
artifact are documented in [`docs/POPULATION_PROVENANCE.md`](./docs/POPULATION_PROVENANCE.md).
Saved runs persist to the browser store (and to Supabase when it is configured) via
`src/lib/runStore.ts`; the Dashboard, Data Intelligence, Alerts and Saved Reports pages read real
engine/population data, not mock samples.

---

## Run it locally

Requires **Node 20+** (verified on Node 22) and, optionally, Bun. Bun is faster; the npm fallback
below produces the identical result — it was verified against a clean clone.

```bash
# 1. Get the code
git pull                      # if you already have a clone, update it first
git clone https://github.com/payaldongre/MetaSociety.git   # otherwise, clone fresh
cd MetaSociety

# 2. Install dependencies (pick one)
bun install                   # if Bun is available
npm install                   # fallback: no Bun required (~586 packages)

# 3. Typecheck — must report zero errors before anything else
bunx tsc -b --noEmit

# 4. Run the test suite
bun run test                  # 135 tests, ~2–3 min
npm test                      # same thing without Bun

# 5. Start the app
bun run dev                   # -> http://localhost:8080

# 6. Optional: verify the production bundle
bun run build && bun run preview
```

### Notes that matter

- **Let the tests run alone.** The Simulation Lab suite rolls a full 98,923-agent trajectory.
  `vitest.config.ts` pins it to a single forked worker with a 300-second timeout; running it
  alongside a dev server or other CPU-heavy work can starve Vitest's worker heartbeat and make a
  passing suite exit non-zero. Expect roughly a minute. That cost is the engine actually
  simulating citizens, not a hang.
- **The build prints one advisory warning, not an error.** The main bundle is ~1.16 MB (~331 KB
  gzipped), above Vite's 500 KB advisory threshold. Nothing is broken; code-splitting is future
  work.
- **The app runs with zero configuration.** There is no `.env` required: the engine reads the
  Census-anchored population from source, and saved runs persist to the browser. Sign-in is a local
  stub, and the Dashboard, Data Intelligence, Alerts, Saved Reports and Simulation Lab pages all
  work end to end without any backend.
- **Optional environment variables** (only needed for the corresponding integration — set them in
  the platform's Keys/Environment UI, never commit them):

  | Variable | Enables |
  | --- | --- |
  | `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` | Mirroring saved runs into the `simulations` table |
  | `VITE_API_URL` (default `http://localhost:8000`) | The AI Policy Advisor FastAPI backend |
  | `VITE_DECISION_ENDPOINT` | The optional decision layer in the engine — points at a server-side proxy that holds the provider key |

  > **Never put a real secret in a `VITE_*` variable.** Vite compiles every `VITE_*` value into the public
  > JavaScript bundle, so `VITE_DECISION_API_KEY` (or any provider key) placed here would be readable by every
  > visitor. `VITE_SUPABASE_PUBLISHABLE_KEY` is the one exception: it is a *publishable* key, safe by design.
  > Provider secrets belong on a server-side proxy (see `VITE_DECISION_ENDPOINT`) or in the Convex/server env,
  > set through the platform's Keys/Environment UI — never in a committed `.env` file.

- **Honest caveat on persistence:** the browser-store path is the verified one. The Supabase mirror
  also requires a signed-in user id, and the current auth is a localStorage stub that never
  provides one — so that path is wired and type-checked but not exercised end to end. Connecting real
  auth (against the existing RLS migration in `supabase/migrations/`) is the remaining piece.
- **The decision-layer key is never bundled.** `VITE_DECISION_ENDPOINT` is only the URL of a
  proxy; whatever `VITE_*` value you set is compiled into the public JavaScript bundle, so a
  provider API key must live on the proxy (injected server-side), never in a `VITE_` variable.
- **The Advisor backend is optional** and lives in `backend/` (FastAPI + LangGraph, reads
  `GROQ_API_KEY`). Its dependencies are Python/`pip`, so it installs separately from the frontend.
