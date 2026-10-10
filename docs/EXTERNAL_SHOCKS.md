# External shocks — hypothetical stress testing

This document explains the external-shock system: what it is, what it is not,
and how the pieces fit together. It is the fourth question the Simulation Lab
answers, after GGG and the Bayesian network.

| Component | Question it answers |
|---|---|
| **Policy brief + governance** | What is the policy, and is it a competent body's to decide? |
| **GGG** (`ggg.ts`) | What historically grounded characteristics does this policy inherit, and how strongly should they enter the causal model? |
| **Bayesian network** (`bn.ts`) | Given this policy and this local population/context, what causal consequences follow? |
| **Shock system** (`shocks.ts`) | What if an external event occurs *during* the policy's implementation? |

Keep these separate. A shock is **not** another form of GGG, and it is **not**
historical replay.

## What a shock is not

- It is not a prediction that a disaster will occur.
- It is not a historical outcome copied into a result.
- It is not a final-output adjustment (`GDP -= 15%`). Nothing in this system
  subtracts from a headline number directly.
- It is not a sourced real-world hazard rate. The default arrival rates are
  labelled **scenario assumptions**; the user may always override them.

## What a shock is

A structured, hypothetical event used to stress-test a proposed policy:

```ts
interface ShockDefinition {
  id: string;
  name: string;
  description: string;
  category: "HEALTH" | "ECONOMIC" | "CLIMATE" | "INFRASTRUCTURE" | "SOCIAL" | "OTHER";
  node: ExternalShockNodeId;          // the exogenous BN node it intervenes on
  defaultRatePerYear: number;         // scenario assumption, not a sourced rate
  defaultSeverityWeights: Record<"mild" | "moderate" | "severe", number>;
  provenance: string;                 // always a scenario assumption
}
```

Five generic shocks ship with the model — deliberately **not** named after any
real event:

- Public Health Emergency
- Economic Downturn
- Extreme Flood / Climate Event
- Major Infrastructure Disruption
- Large Employment Shock

## The three modes the user controls

1. **Normal conditions** — no external events. The default and the simplest.
2. **Hypothetical shock scenario** — the user selects a shock, a start period, a
   duration and a severity. No Poisson sampling.
3. **Stochastic shock stress test** — the user sets a shock type and an annual
   arrival rate λ; the simulator generates event timing from a Poisson arrival
   model, deterministically from the seed.

## Poisson models arrivals, not consequences

For a rate λ over a horizon of T years, the number of arrivals is

```
N(T) ~ Poisson(λ · T)
```

The simulator draws N(T) with a seeded Poisson sampler, then draws arrival times
uniformly over the horizon and snaps each to the model's 3-month period grid.
Each arrival gets a severity from the configured (or default) weights.

Poisson therefore answers only: *"given this hypothetical annual event rate, how
many external events occur during this policy's tenure, and roughly when?"* It
says nothing about how severe they are or what they cause.

The rate is displayed as:

```
Arrival-rate assumption:
λ = 0.20 events/year
Source:
User/model assumption
Interpretation:
Used only to generate hypothetical stress-test event timing.
```

## The event queue and dequeue

A generated event is inserted into a **binary min-heap** keyed by simulation
period, with ties broken by insertion order (so the ordering is fully
deterministic). At each period the engine calls `dequeueDue(currentPeriod)`:

```
Poisson / manual generator
        ↓
generate event (period, severity, duration)
        ↓
enqueue  ──►  priority queue sorted by simulation period
        ↓
simulation advances
        ↓
dequeueDue(period)  →  events whose period has arrived
        ↓
apply the event (set the exogenous node for its window)
        ↓
BN propagates the consequences
```

"Dequeue" is exactly that: the operation that removes the next due event from
the queue. It is not a statistical model. Events whose window has ended simply
expire — there is no indefinite persistence.

If several events are due in the same period they are processed in
`(period, insertion order)` order.

## Injection is causal

A dequeued event temporarily intervenes on an **exogenous Bayesian-network
node**:

```
do(ExternalEconomicShock = moderate)   for its active window
do(ExternalEconomicShock = none)       when its window ends
```

The shock node is a root with its own state domain
(`none | mild | moderate | severe`). When it reads `none` every downstream
shift is exactly zero, so a no-shock run is byte-identical to one without the
shock dimension. The engine never permanently mutates the network.

The intervention then propagates through the existing edges:

```
Economic downturn
   → SectorDemand (contracting)
   → EmploymentStatus (less formal work)
   → IncomeClass / SpendingCapacity
   → town aggregation → GDP / employment / inflation
```

```
Health emergency
   → HealthBurden (higher)
   → EmploymentStatus (work disruption)
   → SpendingCapacity (savings drain)
```

No unsupported edges are added; the shock affects only the nodes its
`EXTERNAL_SHIFT` entry declares, and every such entry is a documented model
assumption about direction.

## Fairness: the same shock for baseline and policy

The schedule is generated **once** from the scenario seed and replayed
identically for both trajectories:

```
                 same population
                 same seed
                 same shock schedule
                 ┌───────────────┴───────────────┐
                 ↓                               ↓
             BASELINE                         POLICY
                 ↓                               ↓
                 └───────────────┬───────────────┘
                                 ↓
                    counterfactual comparison
```

The **only** intentional difference is the policy intervention. Shocks are never
sampled independently for baseline and policy — otherwise a policy could look
bad merely because it drew a worse event.

The uncertainty ensemble holds this realization **fixed** too: every ensemble
member and the baseline use the SAME generated schedule, and only the
Monte-Carlo sampling seed varies. The reported headline is an ensemble median and
the reported band is the seed-run interval, both measured against a baseline
that saw the identical events — so the displayed policy delta is never inflated
by comparing an ensemble member under one shock realization with a baseline under
another. Scenario variation is explored by changing the configurable seed or the
scenario configuration; the generated realization for the run is always listed in
the result's `shocks` report and in the scenario preview.

## What the UI shows

- **External conditions** in the policy configuration: normal / hypothetical /
  stochastic, with the timing, severity, arrival rate and maximum-event controls.
- A **scenario preview** listing the exact events a given seed generates, with
  the disclosure that they are hypothetical and shared by baseline and policy.
- After the run, an **External conditions** result card listing every generated
  event, its period, severity, target node, and the counterfactual-fairness
  confirmation (same shock sequence, same seed, same population).

## Worked example

A user proposes a **5-year employment & skills mission** and chooses
**Stochastic external-shock stress test** with λ = 0.20 economic events/year and
λ = 0.10 health events/year.

1. The system uses those λ values to generate hypothetical shock arrivals.
2. The arrivals are inserted into a time-ordered queue.
3. At each simulation period the engine dequeues the due events.
4. Each due event temporarily intervenes on its exogenous BN node.
5. The BN propagates the consequences causally.
6. The exact same schedule is applied to the no-policy baseline.
7. The policy-vs-baseline difference is computed under identical external
   conditions, and the run reports the policy's robustness under the scenario.

## Limitations

- The default arrival rates are **not** sourced hazard rates; they are stress-test
  assumptions and are labelled as such everywhere they appear.
- Severity mapping (`mild` / `moderate` / `severe` → bounded exogenous-node
  states) is a model assumption; only the direction is asserted.
- The model has no recovery dynamics beyond the event window; after an event ends
  the endogenous dynamics resume.
- One town only (Pandharpur). No inter-town spillover or trade exposure.
