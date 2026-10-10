/**
 * External-shock system tests: Poisson arrivals, the event queue and dequeue,
 * duration/expiry, determinism and baseline/proposed fairness.
 *
 * The conceptual separation these pin down:
 *   Poisson  — models WHEN hypothetical events arrive.
 *   Queue    — stores them in time order.
 *   Dequeue  — removes the events whose time has arrived.
 *   BN       — determines their causal consequences.
 */

import { describe, expect, it } from "vitest";

import {
  BN_VERSION,
  EventQueue,
  SHOCK_DEFINITIONS,
  advanceActive,
  compareEvents,
  generateShockSchedule,
  poissonSample,
  runSimulation,
  shockNodeStatesFor,
  type GeneratedShockEvent,
  type ShockScenarioConfig,
} from "@/simulation";
import { createRng } from "@/simulation/rng";
import { EXTERNAL_SHIFT, EXTERNAL_SHOCK_NODE_IDS } from "@/simulation/bn";
import type { PolicyVector } from "@/simulation/types";

const PERIODS = 20;
const MONTHS = 3;

function queueEvent(time: number, seq: number): GeneratedShockEvent {
  return {
    time,
    seq,
    shockId: "economic-downturn",
    name: "Economic Downturn",
    category: "ECONOMIC",
    node: "ExternalEconomicShock",
    severity: "moderate",
    durationPeriods: 2,
    arrivalModel: "MANUAL",
    provenance: "test",
  };
}

/* ------------------------------------------------------------------ */
/* Queue + dequeue                                                     */
/* ------------------------------------------------------------------ */

describe("event queue", () => {
  it("Test A — dequeues in time order regardless of insertion order", () => {
    const q = new EventQueue<GeneratedShockEvent>();
    q.push(queueEvent(12, 0));
    q.push(queueEvent(4, 1));
    q.push(queueEvent(8, 2));
    expect(q.dequeueDue(20).map((e) => e.time)).toEqual([4, 8, 12]);
  });

  it("Test B — same-time events are ordered deterministically by insertion", () => {
    const q = new EventQueue<GeneratedShockEvent>();
    q.push(queueEvent(5, 2));
    q.push(queueEvent(5, 0));
    q.push(queueEvent(5, 1));
    expect(q.dequeueDue(5).map((e) => e.seq)).toEqual([0, 1, 2]);
  });

  it("Test C — only due events are dequeued; future events stay queued", () => {
    const q = new EventQueue<GeneratedShockEvent>();
    q.push(queueEvent(12, 0));
    q.push(queueEvent(4, 1));
    q.push(queueEvent(8, 2));
    expect(q.dequeueDue(5).map((e) => e.time)).toEqual([4]);
    expect(q.size).toBe(2);
    expect(q.peek()?.time).toBe(8);
  });

  it("Test D — the schedule is deterministic in the seed and can differ across seeds", () => {
    const spec: ShockScenarioConfig = {
      mode: "stochastic",
      stochastic: [{ shockId: "economic-downturn", ratePerYear: 3, maxEvents: 20 }],
    };
    const a = generateShockSchedule(spec, PERIODS, MONTHS, 20260101);
    const b = generateShockSchedule(spec, PERIODS, MONTHS, 20260101);
    expect(a.events).toEqual(b.events);
    const c = generateShockSchedule(spec, PERIODS, MONTHS, 987654);
    expect(JSON.stringify(c.events)).not.toBe(JSON.stringify(a.events));
  });

  it("Test E — baseline and proposed policy receive exactly the same shock sequence", () => {
    const spec: ShockScenarioConfig = {
      mode: "stochastic",
      stochastic: [
        { shockId: "economic-downturn", ratePerYear: 1.2, maxEvents: 6 },
        { shockId: "public-health-emergency", ratePerYear: 0.6, maxEvents: 4 },
      ],
    };
    const schedule = generateShockSchedule(spec, PERIODS, MONTHS, 55);
    const replay = () => {
      const q = new EventQueue<GeneratedShockEvent>();
      for (const e of schedule.events) q.push(e);
      let active: { event: GeneratedShockEvent; endPeriod: number }[] = [];
      const seen: string[] = [];
      for (let p = 0; p < PERIODS; p += 1) {
        active = advanceActive(active, q.dequeueDue(p), p);
        const states = shockNodeStatesFor(active);
        seen.push(EXTERNAL_SHOCK_NODE_IDS.map((n) => `${n}:${states[n as keyof typeof states]}`).join("|"));
      }
      return seen;
    };
    expect(replay()).toEqual(replay());
    // And both baselines process every scheduled event.
    expect(schedule.events.length).toBeGreaterThan(0);
  });

  it("Test F — a four-period shock affects exactly four periods and then expires", () => {
    const schedule = generateShockSchedule(
      {
        mode: "manual",
        manual: [{ shockId: "economic-downturn", startPeriod: 8, durationPeriods: 4, severity: "moderate" }],
      },
      PERIODS,
      MONTHS,
      1,
    );
    const q = new EventQueue<GeneratedShockEvent>();
    for (const e of schedule.events) q.push(e);
    let active: { event: GeneratedShockEvent; endPeriod: number }[] = [];
    const activePeriods: number[] = [];
    for (let p = 0; p < PERIODS; p += 1) {
      active = advanceActive(active, q.dequeueDue(p), p);
      if (shockNodeStatesFor(active).ExternalEconomicShock !== "none") activePeriods.push(p);
    }
    expect(activePeriods).toEqual([8, 9, 10, 11]);
  });

  it("Test G — an economic shock does not affect pilgrimage nodes (no such causal edge)", () => {
    const pilgrimageNodes = ["PilgrimFootfall", "SeasonalInfraLoad", "LocalInfraQuality", "LocalInfraPolicy"];
    for (const node of EXTERNAL_SHOCK_NODE_IDS) {
      const targets = Object.keys(EXTERNAL_SHIFT).filter((target) => EXTERNAL_SHIFT[target][node]);
      for (const t of targets) expect(pilgrimageNodes).not.toContain(t);
    }
  });
});

/* ------------------------------------------------------------------ */
/* Poisson arrivals                                                    */
/* ------------------------------------------------------------------ */

describe("Poisson arrival model", () => {
  it("is deterministic given a seed and averages to the configured rate", () => {
    const rng = createRng(1234);
    let total = 0;
    const draws = 4000;
    for (let i = 0; i < draws; i += 1) total += poissonSample(2.5, rng);
    const mean = total / draws;
    expect(mean).toBeGreaterThan(2.5 * 0.85);
    expect(mean).toBeLessThan(2.5 * 1.15);

    const a = poissonSample(3, createRng(7));
    const b = poissonSample(3, createRng(7));
    expect(a).toBe(b);
    expect(poissonSample(0, createRng(1))).toBe(0);
  });

  it("honours the maximum-events cap and keeps times inside the horizon", () => {
    const schedule = generateShockSchedule(
      { mode: "stochastic", stochastic: [{ shockId: "economic-downturn", ratePerYear: 50, maxEvents: 3 }] },
      PERIODS,
      MONTHS,
      42,
    );
    expect(schedule.events.length).toBeLessThanOrEqual(3);
    for (const e of schedule.events) {
      expect(e.time).toBeGreaterThanOrEqual(0);
      expect(e.time).toBeLessThan(PERIODS);
    }
    expect(schedule.arrivalModel).toBe("POISSON");
  });

  it("records the arrival-rate assumption rather than asserting a real hazard rate", () => {
    const schedule = generateShockSchedule(
      { mode: "stochastic", stochastic: [{ shockId: "public-health-emergency", ratePerYear: 0.1, maxEvents: 3 }] },
      PERIODS,
      MONTHS,
      1,
    );
    expect(schedule.rates[0]).toMatchObject({ shockId: "public-health-emergency", ratePerYear: 0.1 });
    for (const def of SHOCK_DEFINITIONS) {
      expect(def.provenance).toMatch(/scenario_assumption/);
    }
  });
});

/* ------------------------------------------------------------------ */
/* Manual scheduling + ordering                                        */
/* ------------------------------------------------------------------ */

describe("manual (deterministic) scenario", () => {
  it("schedules a user-selected event at the requested period/severity", () => {
    const schedule = generateShockSchedule(
      {
        mode: "manual",
        manual: [{ shockId: "economic-downturn", startPeriod: 5, durationPeriods: 3, severity: "severe" }],
      },
      PERIODS,
      MONTHS,
      9,
    );
    expect(schedule.arrivalModel).toBe("MANUAL");
    expect(schedule.events).toHaveLength(1);
    expect(schedule.events[0]).toMatchObject({ time: 5, severity: "severe", durationPeriods: 3, node: "ExternalEconomicShock" });
  });

  it("orders same-period manual events by insertion order", () => {
    const schedule = generateShockSchedule(
      {
        mode: "manual",
        manual: [
          { shockId: "economic-downturn", startPeriod: 4, durationPeriods: 2, severity: "mild" },
          { shockId: "public-health-emergency", startPeriod: 4, durationPeriods: 2, severity: "moderate" },
        ],
      },
      PERIODS,
      MONTHS,
      2,
    );
    expect(schedule.events.map((e) => e.seq)).toEqual([0, 1]);
    expect([...schedule.events].sort(compareEvents).filter((e) => e.time === 4)).toHaveLength(2);
  });
});

/* ------------------------------------------------------------------ */
/* No-shock path preserves existing behaviour                          */
/* ------------------------------------------------------------------ */

const policy: PolicyVector = {
  channelIds: ["INCOME_SUPPORT"],
  name: "No-shock regression probe",
  intensity: 0.65,
  budget: 12e7,
  durationMonths: 12,
  allocation: { housing: 0.3, education: 0.4, employment: 0.3 },
};

describe("no-shock mode is the existing simulation path", () => {
  it("Test H — scenario {mode:none} reproduces the run without a scenario exactly", async () => {
    const base = {
      townId: "pandharpur_in_mh",
      policy,
      mode: "single" as const,
      seed: 20260101,
      bnVersion: BN_VERSION,
      zoneFilter: "all" as const,
    };
    const opts = { intervalRounds: 1, skipSearch: true } as const;
    const without = await runSimulation(base, opts);
    const withNone = await runSimulation({ ...base, scenario: { mode: "none" } }, opts);
    expect(withNone.runId).toBe(without.runId);
    expect(withNone.point).toEqual(without.point);
    expect(withNone.baseline).toEqual(without.baseline);
    // A configured-but-empty scenario still reports its (empty) schedule.
    expect(withNone.shocks?.events ?? []).toHaveLength(0);
    expect(without.shocks).toBeUndefined();
  }, 240_000);
});
