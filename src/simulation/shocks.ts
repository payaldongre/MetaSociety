/**
 * External shocks — hypothetical stress-test events for a proposed policy.
 *
 * WHAT THIS IS. A small, deterministic scenario generator that answers a
 * DIFFERENT question from GGG and the Bayesian network:
 *
 *   GGG  — "what historically grounded characteristics does this policy inherit?"
 *   BN   — "given the policy and this population, what causal consequences follow?"
 *   SHOCK — "what if an external event occurs DURING the policy's implementation?"
 *
 * It is explicit stress testing, not forecasting. An event generated here is a
 * hypothetical, user-configured interruption used to test whether a policy is
 * robust; it is never presented as a prediction that a disaster will happen.
 *
 * THE THREE PIECES, KEPT SEPARATE (this is the conceptual point).
 *   1. ARRIVAL — how many events, and when. For stochastic mode this is a
 *      Poisson process: N(T) ~ Poisson(lambda * T), with lambda an explicit,
 *      labelled scenario assumption (never a sourced real-world hazard rate).
 *      Arrival times are then drawn deterministically from the simulation seed.
 *   2. QUEUE   — the generated events are inserted into a time-ordered priority
 *      queue (a binary min-heap keyed by simulation period, ties broken by
 *      insertion order).
 *   3. DEQUEUE — at each simulation period the engine removes every event whose
 *      time has arrived (`dequeueDue`). "Dequeue" is that operation: it pops the
 *      next scheduled event from the queue. It is not a statistical model.
 *
 * The event's CONSEQUENCES are not computed here. A dequeued event sets an
 * EXOGENOUS Bayesian-network node (e.g. `ExternalEconomicShock = moderate`) for
 * its active window, and the network propagates the effect causally through the
 * existing edges. Nothing here does `GDP -= 15%`.
 *
 * FAIR COMPARISON. The schedule is generated ONCE from the scenario seed and is
 * replayed identically for the no-policy baseline and the proposed policy, so a
 * policy is never made to look worse merely because it drew a different shock.
 */

import { createRng, type Rng } from "./rng";

/* ------------------------------------------------------------------ */
/* Vocabularies                                                        */
/* ------------------------------------------------------------------ */

export const SHOCK_CATEGORIES = ["HEALTH", "ECONOMIC", "CLIMATE", "INFRASTRUCTURE", "SOCIAL", "OTHER"] as const;
export type ShockCategory = (typeof SHOCK_CATEGORIES)[number];

/** The severity of a single event. Bounded; a model assumption, not a measurement. */
export const SHOCK_SEVERITIES = ["mild", "moderate", "severe"] as const;
export type ShockSeverity = (typeof SHOCK_SEVERITIES)[number];

/** The exogenous BN node an event intervenes on, with its state domain. */
export const EXTERNAL_SHOCK_NODES = [
  "ExternalHealthShock",
  "ExternalEconomicShock",
  "ExternalClimateShock",
  "ExternalInfrastructureShock",
  "ExternalSocialShock",
] as const;
export type ExternalShockNodeId = (typeof EXTERNAL_SHOCK_NODES)[number];

/** Domain of every exogenous shock node, in state order. */
export const SHOCK_NODE_DOMAIN = ["none", "mild", "moderate", "severe"] as const;

/** Maps a shock node to the downstream BN nodes its intervention can move. */
export const SHOCK_AFFECTED_NODES: Record<ExternalShockNodeId, string[]> = {
  ExternalEconomicShock: ["SectorDemand", "IncomeClass", "EmploymentStatus", "SpendingCapacity"],
  ExternalHealthShock: ["HealthBurden", "EmploymentStatus", "SpendingCapacity"],
  ExternalClimateShock: ["SectorDemand", "HouseholdStress", "HealthBurden"],
  ExternalInfrastructureShock: ["HouseholdStress"],
  ExternalSocialShock: ["ProtestRiskBand", "MigrationIntentBand"],
};

export interface ShockDefinition {
  id: string;
  name: string;
  description: string;
  category: ShockCategory;
  /** The exogenous BN node this shock intervenes on. */
  node: ExternalShockNodeId;
  /** Documented default arrival rate for the stochastic mode (events/year). */
  defaultRatePerYear: number;
  defaultSeverityWeights: Record<ShockSeverity, number>;
  /** Where the assumption comes from. Always a scenario assumption here. */
  provenance: string;
}

/**
 * Generic hypothetical shocks. Deliberately NOT "COVID" or any real named
 * event: the user chooses whether to test them, and none implies a factual
 * probability. The default rates are labelled model assumptions.
 */
export const SHOCK_DEFINITIONS: ShockDefinition[] = [
  {
    id: "public-health-emergency",
    name: "Public Health Emergency",
    description:
      "A hypothetical pandemic-like health shock that raises health burden, disrupts work and drains household savings.",
    category: "HEALTH",
    node: "ExternalHealthShock",
    defaultRatePerYear: 0.1,
    defaultSeverityWeights: { mild: 0.5, moderate: 0.35, severe: 0.15 },
    provenance: "scenario_assumption: user-configured hypothetical stress test",
  },
  {
    id: "economic-downturn",
    name: "Economic Downturn",
    description:
      "A hypothetical demand contraction that weakens sector demand, employment and household spending capacity.",
    category: "ECONOMIC",
    node: "ExternalEconomicShock",
    defaultRatePerYear: 0.2,
    defaultSeverityWeights: { mild: 0.55, moderate: 0.32, severe: 0.13 },
    provenance: "scenario_assumption: user-configured hypothetical stress test",
  },
  {
    id: "extreme-flood",
    name: "Extreme Flood / Climate Event",
    description:
      "A hypothetical climate event that damages livelihoods and raises household stress and health burden.",
    category: "CLIMATE",
    node: "ExternalClimateShock",
    defaultRatePerYear: 0.12,
    defaultSeverityWeights: { mild: 0.5, moderate: 0.35, severe: 0.15 },
    provenance: "scenario_assumption: user-configured hypothetical stress test",
  },
  {
    id: "infrastructure-disruption",
    name: "Major Infrastructure Disruption",
    description: "A hypothetical failure of water, power or transport that raises household stress.",
    category: "INFRASTRUCTURE",
    node: "ExternalInfrastructureShock",
    defaultRatePerYear: 0.08,
    defaultSeverityWeights: { mild: 0.6, moderate: 0.3, severe: 0.1 },
    provenance: "scenario_assumption: user-configured hypothetical stress test",
  },
  {
    id: "employment-shock",
    name: "Large Employment Shock",
    description:
      "A hypothetical mass-displacement event that raises protest risk and migration intent.",
    category: "SOCIAL",
    node: "ExternalSocialShock",
    defaultRatePerYear: 0.06,
    defaultSeverityWeights: { mild: 0.55, moderate: 0.3, severe: 0.15 },
    provenance: "scenario_assumption: user-configured hypothetical stress test",
  },
];

export function shockDefinitionById(id: string): ShockDefinition | undefined {
  return SHOCK_DEFINITIONS.find((s) => s.id === id);
}

export function severityStateIndex(severity: ShockSeverity): number {
  return SHOCK_SEVERITIES.indexOf(severity) + 1; // 0 is "none"
}

/* ------------------------------------------------------------------ */
/* Scenario configuration (the UI's input)                             */
/* ------------------------------------------------------------------ */

export interface ManualShockSpec {
  /** Id from SHOCK_DEFINITIONS. */
  shockId: string;
  /** 0-based simulation period the event begins in. */
  startPeriod: number;
  /** How many periods the event stays active. */
  durationPeriods: number;
  severity: ShockSeverity;
}

export interface StochasticShockSpec {
  shockId: string;
  /** Expected event arrivals per year. A stated scenario assumption. */
  ratePerYear: number;
  /** Optional per-severity weights; defaults to the definition's. */
  severityWeights?: Record<ShockSeverity, number>;
  /** Hard cap on generated events for this shock, for tractability. */
  maxEvents?: number;
}

export interface ShockScenarioConfig {
  mode: "none" | "manual" | "stochastic";
  manual?: ManualShockSpec[];
  stochastic?: StochasticShockSpec[];
}

export const NO_SHOCKS: ShockScenarioConfig = { mode: "none" };

/* ------------------------------------------------------------------ */
/* Generated events                                                    */
/* ------------------------------------------------------------------ */

export interface GeneratedShockEvent {
  /** 0-based simulation period the event begins in. */
  time: number;
  /** Monotonic insertion index — the deterministic tie-break. */
  seq: number;
  shockId: string;
  name: string;
  category: ShockCategory;
  node: ExternalShockNodeId;
  severity: ShockSeverity;
  durationPeriods: number;
  /** How the event entered the schedule. */
  arrivalModel: "MANUAL" | "POISSON";
  provenance: string;
}

export interface ShockSchedule {
  events: GeneratedShockEvent[];
  /** "MANUAL" | "POISSON" | "NONE" — the arrival mechanism(s) used. */
  arrivalModel: "MANUAL" | "POISSON" | "NONE";
  /** The lambda values actually used, by shock id. */
  rates: { shockId: string; ratePerYear: number; expectedArrivals: number }[];
  seed: number;
  periods: number;
  monthsEach: number;
}

/* ------------------------------------------------------------------ */
/* Poisson arrivals                                                    */
/* ------------------------------------------------------------------ */

/**
 * Sample a Poisson count with mean `mean`, deterministically from `rng`.
 * Knuth's method is exact for small means; for large means a normal
 * approximation is used so a pathological lambda cannot spin forever. Both
 * paths are deterministic in the seed.
 */
export function poissonSample(mean: number, rng: Rng): number {
  if (!(mean > 0)) return 0;
  if (mean > 30) {
    const n = Math.round(mean + Math.sqrt(mean) * rng.normal());
    return Math.max(0, n);
  }
  const limit = Math.exp(-mean);
  let k = 0;
  let p = 1;
  do {
    k += 1;
    p *= rng.next();
  } while (p > limit);
  return k - 1;
}

function pickSeverity(weights: Record<ShockSeverity, number>, rng: Rng): ShockSeverity {
  const total = SHOCK_SEVERITIES.reduce((a, s) => a + Math.max(0, weights[s] ?? 0), 0);
  if (total <= 0) return "moderate";
  let r = rng.next() * total;
  for (const s of SHOCK_SEVERITIES) {
    r -= Math.max(0, weights[s] ?? 0);
    if (r <= 0) return s;
  }
  return "severe";
}

/* ------------------------------------------------------------------ */
/* Schedule generation                                                 */
/* ------------------------------------------------------------------ */

/**
 * Build the event schedule for a scenario. Deterministic given
 * (scenario, periods, monthsEach, seed) — the simulation seed is the only
 * randomness, and it is the SAME seed used for the baseline and the policy.
 */
export function generateShockSchedule(
  scenario: ShockScenarioConfig | undefined,
  periods: number,
  monthsEach: number,
  seed: number,
): ShockSchedule {
  const empty: ShockSchedule = { events: [], arrivalModel: "NONE", rates: [], seed, periods, monthsEach };
  if (!scenario || scenario.mode === "none" || periods <= 0) return empty;

  // A dedicated, isolated stream so shock timing can never perturb the
  // population/BN stream for a given run seed.
  const rng = createRng((seed ^ 0x5f0c4a11) >>> 0);
  const events: GeneratedShockEvent[] = [];
  const rates: ShockSchedule["rates"] = [];
  let seq = 0;

  const push = (
    def: ShockDefinition,
    time: number,
    severity: ShockSeverity,
    durationPeriods: number,
    arrivalModel: "MANUAL" | "POISSON",
  ) => {
    events.push({
      time,
      seq: seq++,
      shockId: def.id,
      name: def.name,
      category: def.category,
      node: def.node,
      severity,
      durationPeriods,
      arrivalModel,
      provenance: def.provenance,
    });
  };

  if (scenario.mode === "manual") {
    for (const spec of scenario.manual ?? []) {
      const def = shockDefinitionById(spec.shockId);
      if (!def) continue;
      const start = Math.max(0, Math.min(periods - 1, Math.round(spec.startPeriod)));
      const duration = Math.max(1, Math.round(spec.durationPeriods));
      push(def, start, spec.severity, duration, "MANUAL");
    }
    events.sort(compareEvents);
    return { events, arrivalModel: "MANUAL", rates, seed, periods, monthsEach };
  }

  // Stochastic: independent Poisson processes per configured shock.
  const years = (periods * monthsEach) / 12;
  for (const spec of scenario.stochastic ?? []) {
    const def = shockDefinitionById(spec.shockId);
    if (!def) continue;
    const rate = Math.max(0, spec.ratePerYear);
    const mean = rate * years;
    const cap = Math.max(0, Math.round(spec.maxEvents ?? 8));
    const count = Math.min(cap, poissonSample(mean, rng));
    rates.push({ shockId: def.id, ratePerYear: rate, expectedArrivals: mean });
    const weights = spec.severityWeights ?? def.defaultSeverityWeights;
    for (let i = 0; i < count; i += 1) {
      // Arrival time uniform over the horizon, snapped to a 3-month period.
      const month = rng.next() * periods * monthsEach;
      const time = Math.max(0, Math.min(periods - 1, Math.floor(month / monthsEach)));
      const severity = pickSeverity(weights, rng);
      const durationPeriods = severity === "mild" ? 1 : severity === "moderate" ? 2 : 3;
      push(def, time, severity, durationPeriods, "POISSON");
    }
  }
  events.sort(compareEvents);
  return { events, arrivalModel: "POISSON", rates, seed, periods, monthsEach };
}

/** Deterministic ordering: by time, then insertion order. */
export function compareEvents(a: GeneratedShockEvent, b: GeneratedShockEvent): number {
  return a.time - b.time || a.seq - b.seq;
}

/* ------------------------------------------------------------------ */
/* Event queue (binary min-heap keyed by time, ties by insertion order) */
/* ------------------------------------------------------------------ */

export interface QueueItem {
  time: number;
  seq: number;
}

export class EventQueue<T extends QueueItem> {
  private heap: T[] = [];

  get size(): number {
    return this.heap.length;
  }

  push(item: T): void {
    this.heap.push(item);
    let i = this.heap.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (compareQueue(this.heap[parent], this.heap[i]) <= 0) break;
      [this.heap[parent], this.heap[i]] = [this.heap[i], this.heap[parent]];
      i = parent;
    }
  }

  peek(): T | undefined {
    return this.heap[0];
  }

  /** Remove and return the earliest item, or undefined when empty. */
  pop(): T | undefined {
    if (this.heap.length === 0) return undefined;
    const top = this.heap[0];
    const last = this.heap.pop() as T;
    if (this.heap.length > 0) {
      this.heap[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let smallest = i;
        if (l < this.heap.length && compareQueue(this.heap[l], this.heap[smallest]) < 0) smallest = l;
        if (r < this.heap.length && compareQueue(this.heap[r], this.heap[smallest]) < 0) smallest = r;
        if (smallest === i) break;
        [this.heap[smallest], this.heap[i]] = [this.heap[i], this.heap[smallest]];
        i = smallest;
      }
    }
    return top;
  }

  /**
   * Dequeue every event whose time is due at or before `now`, in deterministic
   * order (time, then insertion order). Future events stay queued.
   */
  dequeueDue(now: number): T[] {
    const out: T[] = [];
    while (this.heap.length > 0 && this.heap[0].time <= now) {
      out.push(this.pop() as T);
    }
    return out;
  }
}

function compareQueue(a: QueueItem, b: QueueItem): number {
  return a.time - b.time || a.seq - b.seq;
}

/* ------------------------------------------------------------------ */
/* Active-state resolution                                             */
/* ------------------------------------------------------------------ */

export interface ActiveShock {
  event: GeneratedShockEvent;
  endPeriod: number;
}

/**
 * Resolve the set of events active at `period`, from the events dequeued so
 * far. Returns the active events and the surviving set for the next period, so
 * an event expires exactly when its window ends (no indefinite persistence).
 */
export function advanceActive(active: ActiveShock[], due: GeneratedShockEvent[], period: number): ActiveShock[] {
  const next = active.filter((a) => a.endPeriod >= period);
  for (const event of due) next.push({ event, endPeriod: event.time + event.durationPeriods - 1 });
  return next;
}

/**
 * The exogenous-node states at a period: for each shock node, the most severe
 * active event (none when nothing is active). Deterministic — events are
 * already in (time, seq) order and severities are ranked.
 */
export function shockNodeStatesFor(active: ActiveShock[]): Record<ExternalShockNodeId, string> {
  const out = {} as Record<ExternalShockNodeId, string>;
  for (const node of EXTERNAL_SHOCK_NODES) out[node] = "none";
  for (const { event } of active) {
    const current = out[event.node];
    if (SHOCK_NODE_DOMAIN.indexOf(event.severity) > SHOCK_NODE_DOMAIN.indexOf(current as never)) {
      out[event.node] = event.severity;
    }
  }
  return out;
}

/** A reproducible description of the generated scenario, for the UI and JSON. */
export interface ShockReport {
  mode: "none" | "manual" | "stochastic";
  arrivalModel: "NONE" | "MANUAL" | "POISSON";
  policyHorizonMonths: number;
  periods: number;
  seed: number;
  events: GeneratedShockEvent[];
  rates: { shockId: string; ratePerYear: number; expectedArrivals: number }[];
  /** Explicit statement that this is a stress test, not a prediction. */
  disclosure: string;
  /** Same schedule for baseline and proposed policy. */
  sameScheduleForBaselineAndPolicy: true;
  /** Which nodes each event intervened on. */
  affectedNodes: string[];
}

export function buildShockReport(
  scenario: ShockScenarioConfig | undefined,
  schedule: ShockSchedule,
): ShockReport {
  const mode = scenario?.mode ?? "none";
  const affected = new Set<string>();
  for (const e of schedule.events) for (const n of SHOCK_AFFECTED_NODES[e.node]) affected.add(n);
  return {
    mode,
    arrivalModel: schedule.arrivalModel,
    policyHorizonMonths: schedule.periods * schedule.monthsEach,
    periods: schedule.periods,
    seed: schedule.seed,
    events: schedule.events,
    rates: schedule.rates,
    disclosure:
      "External shocks are hypothetical stress-test events, not predictions of future disasters. In stochastic mode the event timing is generated from the configured arrival model and is held identical across the baseline and the policy, so policy differences remain comparable. Poisson controls event arrival frequency; the event queue determines when scheduled events are applied; the Bayesian network determines their causal consequences.",
    sameScheduleForBaselineAndPolicy: true,
    affectedNodes: [...affected].sort(),
  };
}
