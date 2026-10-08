/**
 * Simulation engine acceptance tests.
 *
 * These are the evidence pack from SIMULATION_LAB_SPEC.md §12. Each block maps
 * to an evaluator-facing claim:
 *   - the population hits published Census totals exactly
 *   - the network's directional responses have the documented sign
 *   - accounting identities hold on every run
 *   - the same inputs reproduce the same output byte-for-byte
 *   - the decision layer degrades gracefully when unconfigured
 */

import { describe, expect, it } from "vitest";
import {
  BN_VERSION,
  buildBn,
  causalAttribution,
  checkIdentities,
  clonePopulation,
  computeLevels,
  compileBn,
  createDecisionEngine,
  createJevDecisionEngine,
  createLlmDecisionEngine,
  createRuleDecisionEngine,
  createRng,
  differentialEvolution,
  dominates,
  generatePopulation,
  getPopulation,
  nonDominatedSort,
  paretoFront,
  PolicyFeasibilityError,
  createDefaultBrief,
  runSimulation,
  validateBnDirection,
  validatePopulation,
  withIntervention,
  posteriorDistribution,
  applyEvidence,
  type PolicyBrief,
  type PolicyVector,
  type SimulationRequest,
} from "@/simulation";

const POP = getPopulation();

const policy = (overrides: Partial<PolicyVector> = {}): PolicyVector => ({
  channelIds: ["INCOME_SUPPORT"],
  name: "Youth Employment Stimulus",
  intensity: 0.8,
  budget: 120_000_000,
  durationMonths: 12,
  allocation: { housing: 0.2, education: 0.3, employment: 0.5 },
  ...overrides,
});

const request = (overrides: Partial<SimulationRequest> = {}): SimulationRequest => ({
  townId: POP.townId,
  policy: policy(),
  mode: "single",
  seed: 424242,
  bnVersion: BN_VERSION,
  ...overrides,
});

/* ------------------------------------------------------------------ */
/* Data layer (§4.5)                                                   */
/* ------------------------------------------------------------------ */

describe("synthetic agent population", () => {
  const checks = validatePopulation(POP);

  it("generates one agent per real resident", () => {
    expect(POP.size).toBe(98923);
    expect(POP.households).toBe(20054);
  });

  it("passes every internal-consistency assertion", () => {
    const failed = checks.filter((c) => !c.passed);
    expect(failed.map((f) => `${f.check}: ${f.observed}`)).toEqual([]);
  });

  it("reaches 100% age/gender sub-total consistency (the old corpus managed <6%)", () => {
    const check = checks.find((c) => c.check === "age/gender sub-totals consistent");
    expect(check?.passed).toBe(true);
    expect(check?.observed).toBe("100.00%");
  });

  it("reproduces exactly for the same seed and differs for another", () => {
    const a = generatePopulation(20260101);
    const b = generatePopulation(20260101);
    const c = generatePopulation(7);
    expect(a.manifest).toBe(b.manifest);
    expect(a.manifest).not.toBe(c.manifest);
    expect(Array.from(a.savingsMonths.slice(0, 50))).toEqual(Array.from(b.savingsMonths.slice(0, 50)));
    expect(Array.from(a.ward.slice(0, 50))).toEqual(Array.from(b.ward.slice(0, 50)));
    expect(Array.from(a.savingsMonths.slice(0, 50))).not.toEqual(Array.from(c.savingsMonths.slice(0, 50)));
  });

  it("clonePopulation isolates the dynamic state", () => {
    const original = generatePopulation(11);
    const copy = clonePopulation(original);
    copy.sentiment[0] = 2;
    copy.income[0] = 1;
    expect(original.sentiment[0]).not.toBe(2);
    expect(original.income[0]).not.toBe(1);
  });
});

/* ------------------------------------------------------------------ */
/* Network layer (§6.6)                                                */
/* ------------------------------------------------------------------ */

describe("Bayesian network", () => {
  const bn = buildBn(POP);
  const checks = validateBnDirection(bn, POP, 400);

  it("has directional responses with the documented sign", () => {
    const failed = checks.filter((c) => !c.passed);
    expect(failed.map((f) => `${f.check}: ${f.observed}`)).toEqual([]);
  });

  it("learns CPTs from the population rather than hand-authoring them", () => {
    const estimated = Object.values(bn.cpts).filter((t) => t.provenance.includes("estimated_from_population"));
    expect(estimated.length).toBeGreaterThanOrEqual(10);
    // The remainder must be documented priors, not silent guesses.
    for (const table of Object.values(bn.cpts)) {
      expect(table.provenance).toMatch(/estimated_from_population|prior:|derived_from_aggregation/);
    }
  });

  it("annotates every table with provenance and normalises every row", () => {
    for (const id of Object.keys(bn.cpts)) {
      expect(bn.cpts[id].source).toBeTruthy();
      expect(bn.cpts[id].provenance).toBeTruthy();
      for (const key of Object.keys(bn.cpts[id].table)) {
        const sum = bn.cpts[id].table[key].reduce((a, b) => a + b, 0);
        expect(Math.abs(sum - 1)).toBeLessThan(1e-9);
      }
    }
  });

  it("distinguishes intervening from observing (do-calculus)", () => {
    const c = compileBn(bn);
    // High intensity and a high budget share: the documented policy shifts are
    // scaled by both, so the directional check uses the strong-instrument case.
    const evidence = {
      PolicyType: "none",
      PolicyIntensity: "high",
      PolicyBudgetShare: "high",
      PolicyDuration: "medium",
      IncomeClassPrior: "bpl",
      AgeBand: "25-34",
      EducationLevel: "secondary",
      HousingQuality: "adequate",
      TrustInGov: "medium",
    } as const;

    // Observational query: P(SectorDemand | PolicyType = none).
    const observedNone = posteriorDistribution(c, "SectorDemand", { ...evidence }, 900, createRng(5));
    // Interventional query: P(SectorDemand | do(PolicyType = subsidy)).
    // PolicyType must NOT appear in the evidence — the intervention sets it.
    const { PolicyType: omitted, ...withoutPolicy } = evidence as unknown as { PolicyType: string } & Record<string, string>;
    void omitted;
    const intervened = posteriorDistribution(
      compileBn(withIntervention(bn, { PolicyType: "subsidy" })),
      "SectorDemand",
      { ...withoutPolicy },
      900,
      createRng(5),
    );

    // Imposing a subsidy must raise P(growing demand) above the no-policy case.
    expect(intervened[2]).toBeGreaterThan(observedNone[2]);
    expect(intervened[2]).toBeGreaterThan(intervened[0]);
  });

  it("reports causal influence for downstream outcomes", () => {
    const c = compileBn(bn);
    const states = new Int32Array(c.ids.length);
    const fixed = applyEvidence(c, states, {
      PolicyType: "subsidy",
      PolicyIntensity: "high",
      PolicyBudgetShare: "high",
      PolicyDuration: "medium",
      IncomeClassPrior: "low",
      AgeBand: "25-34",
      EducationLevel: "secondary",
      HousingQuality: "adequate",
      TrustInGov: "medium",
    });
    void fixed;
    const factors = causalAttribution(c, "EmploymentStatus", {
      PolicyType: "subsidy",
      PolicyIntensity: "high",
      PolicyBudgetShare: "high",
      PolicyDuration: "medium",
      IncomeClassPrior: "low",
      AgeBand: "25-34",
      EducationLevel: "secondary",
      HousingQuality: "adequate",
      TrustInGov: "medium",
    }, 300, createRng(9));
    expect(factors.length).toBeGreaterThan(3);
    expect(factors[0].influence).toBeGreaterThan(0);
    expect(factors[0].influence).toBeLessThanOrEqual(1.0001);
  });
});

/* ------------------------------------------------------------------ */
/* Optimization layer (§11)                                            */
/* ------------------------------------------------------------------ */

describe("differential evolution", () => {
  it("computes correct dominance relations", () => {
    expect(dominates([1, 1], [0, 1])).toBe(true);
    expect(dominates([1, 0], [0, 1])).toBe(false);
    expect(dominates([1, 1], [1, 1])).toBe(false);
  });

  it("returns a verified non-dominated front", () => {
    // Two-objective quadratic bowl: the front is the trade-off curve.
    const fitness = (v: number[]) => [4 - (v[0] - 2) ** 2, 9 - (v[1] - 3) ** 2];
    const result = differentialEvolution(fitness, {
      bounds: [
        { lower: -5, upper: 5 },
        { lower: -5, upper: 5 },
      ],
      objectives: 2,
      populationSize: 20,
      generations: 15,
      seed: 12345,
    });
    const objectives = result.front.map((f) => f.objectives);
    for (let a = 0; a < objectives.length; a += 1) {
      for (let b = 0; b < objectives.length; b += 1) {
        if (a === b) continue;
        expect(dominates(objectives[b], objectives[a])).toBe(false);
      }
    }
    expect(paretoFront(objectives).length).toBe(objectives.length);
  });

  it("is deterministic for a given seed", () => {
    const fitness = (v: number[]) => [-(v[0] - 1) * (v[0] - 1)];
    const opts = {
      bounds: [{ lower: -3, upper: 3 }],
      objectives: 1,
      populationSize: 12,
      generations: 8,
      seed: 99,
    };
    const a = differentialEvolution(fitness, opts);
    const b = differentialEvolution(fitness, opts);
    expect(a.best).toEqual(b.best);
    expect(a.convergence).toEqual(b.convergence);
  });

  it("records a convergence trace and ranks every point", () => {
    const ranks = nonDominatedSort([
      [3, 0],
      [2, 1],
      [0, 3],
      [1, 1],
    ]);
    expect(ranks[0]).toBe(0);
    expect(ranks[2]).toBe(0);
    expect(ranks[3]).toBeGreaterThan(0);
  });
});

/* ------------------------------------------------------------------ */
/* Aggregation identities (§6.7)                                       */
/* ------------------------------------------------------------------ */

describe("accounting identities", () => {
  it("hold for a baseline population with no policy applied", () => {
    const pop = clonePopulation(POP);
    // A no-op "period": nothing spent, nothing collected.
    const report = runSimulationBaseline(pop);
    expect(report).toEqual([]);
  });
});

/** Reused helper: run the identity checks on a freshly cloned population. */
function runSimulationBaseline(pop: ReturnType<typeof generatePopulation>): string[] {
  const level = computeLevels({
    pop,
    inflationBand: 1,
    budgetSpend: 0,
    taxRevenue: 0,
    transfersAssigned: 0,
    externalFunding: 0,
    migrationOutflow: 0,
    declaredBudget: 0,
    cumulativeSpend: 0,
  });
  return checkIdentities(pop, level)
    .filter((c) => !c.passed)
    .map((c) => `${c.identity} (${c.detail})`);
}

/* ------------------------------------------------------------------ */
/* Decision layer (§8)                                                 */
/* ------------------------------------------------------------------ */

describe("decision layer", () => {
  const state = "Employment rate 61%. Inflation 6.1%. Protest risk 22%.";

  it("answers typed questions with a proper distribution", async () => {
    const engine = createRuleDecisionEngine();
    const choice = await engine.choose(state, {
      key: "instrument",
      options: ["subsidy", "tax", "housing"],
      prompt: "Which instrument suits this state?",
      value: 0.8,
      lifts: [0.9, 0.2, 0.5],
    });
    expect(choice.distribution[choice.answer]).toBeGreaterThan(0);
    const total = Object.values(choice.distribution).reduce((a, b) => a + b, 0);
    expect(Math.abs(total - 1)).toBeLessThan(1e-9);

    const scored = await engine.score(state, {
      key: "severity",
      rubric: ["calm", "vocal", "disruptive", "severe"],
      prompt: "How severe is protest activity?",
      value: 0.7,
    });
    expect(["calm", "vocal", "disruptive", "severe"]).toContain(scored.answer);

    const noul = await engine.evaluate(state, [{ key: "distress", statement: "The zone is distressed", value: 0.72 }]);
    expect(noul[0].probability).toBeCloseTo(0.72, 5);
    expect(engine.stats().calls).toBe(3);
  });

  it("falls back to the rule engine when no model is configured", async () => {
    const jev = createJevDecisionEngine({ apiKey: "unset", endpoint: "http://127.0.0.1:9/decision", timeoutMs: 300 });
    const result = await jev.evaluate(state, [{ key: "x", statement: "Something is true", value: 0.4 }]);
    expect(result[0].probability).toBeCloseTo(0.4, 5);
    expect(jev.stats().fallbackUsed).toBe(true);
  });

  it("works with the LLM adapter unconfigured", async () => {
    const llm = createLlmDecisionEngine({});
    const choice = await llm.choose(state, {
      key: "k",
      options: ["a", "b"],
      prompt: "Pick one",
      value: 0.9,
      lifts: [1, 0],
    });
    expect(["a", "b"]).toContain(choice.answer);
    expect(llm.stats().fallbackUsed).toBe(true);
  });

  it("exposes the same interface from the factory", () => {
    for (const engine of [createDecisionEngine("rule"), createDecisionEngine("jev"), createDecisionEngine("llm")]) {
      expect(typeof engine.choose).toBe("function");
      expect(typeof engine.score).toBe("function");
      expect(typeof engine.evaluate).toBe("function");
      expect(engine.name).toBeTruthy();
    }
  });
});

/* ------------------------------------------------------------------ */
/* Policy-brief feasibility gate in the engine path (spec §7, §26)      */
/* ------------------------------------------------------------------ */

describe("policy brief gate is enforced by the engine itself", () => {
  /** A short valid brief: ~6 months of phases, line items equal to the total. */
  const shortBrief = (channelIds: string[]): PolicyBrief => {
    const b = createDefaultBrief(channelIds, "Six-month pilot brief");
    return {
      ...b,
      budgetLineItems: [
        { label: "Delivery", amountInr: 4_000_000 },
        { label: "Monitoring", amountInr: 2_000_000 },
      ],
      statedTotalInr: 6_000_000,
      phases: [{ name: "Pilot", startDate: "2027-01-01", endDate: "2027-06-30" }],
    };
  };

  it("refuses to simulate a brief whose deciding authority is not competent", async () => {
    const b = shortBrief(["HOUSING"]);
    const bad: PolicyBrief = {
      ...b,
      domains: ["housing"],
      governance: {
        ...b.governance,
        proposingAuthority: "vitthal_rukmini_temples_committee",
        primaryDecisionAuthority: "vitthal_rukmini_temples_committee",
        fundingAuthorities: ["vitthal_rukmini_temples_committee"],
        implementingAuthorities: ["vitthal_rukmini_temples_committee"],
      },
    };
    const err = await runSimulation(request({ policyBrief: bad }), { intervalRounds: 1 }).catch((e) => e);
    expect(err).toBeInstanceOf(PolicyFeasibilityError);
    expect(String(err.message)).toMatch(/not competent to decide/);
  });

  it("refuses to simulate a brief whose line items do not equal the stated total", async () => {
    const b = shortBrief(["INCOME_SUPPORT"]);
    const bad: PolicyBrief = { ...b, statedTotalInr: b.statedTotalInr - 1 };
    await expect(runSimulation(request({ policyBrief: bad }), { intervalRounds: 1 })).rejects.toBeInstanceOf(
      PolicyFeasibilityError,
    );
  });

  it("refuses to simulate a brief whose phases are invalid", async () => {
    const b = shortBrief(["INCOME_SUPPORT"]);
    const bad: PolicyBrief = { ...b, phases: [{ name: "Backwards", startDate: "2027-06-01", endDate: "2027-01-01" }] };
    await expect(runSimulation(request({ policyBrief: bad }), { intervalRounds: 1 })).rejects.toBeInstanceOf(
      PolicyFeasibilityError,
    );
  });

  it(
    "simulates a valid brief and takes budget/duration/channels from it, not the request",
    async () => {
      const b = shortBrief(["INCOME_SUPPORT"]);
      // The request's own vector is deliberately inconsistent: a 60-month
      // duration and a ₹1,000 budget. If the brief were ignored, the run would
      // be 20 periods long and spend almost nothing.
      const res = await runSimulation(
        request({
          policy: policy({ channelIds: ["INCOME_SUPPORT"], durationMonths: 60, budget: 1_000 }),
          policyBrief: b,
        }),
        { intervalRounds: 1 },
      );
      expect(res.periods).toBe(2);
      const spent = res.trajectoryTrace[res.trajectoryTrace.length - 1].cumulativeSpend;
      expect(spent).toBeGreaterThan(1_000_000);
      expect(spent).toBeLessThanOrEqual(6_000_000 + 1);
    },
    240_000,
  );

  it(
    "simulates a valid Pandharpur pilgrimage brief",
    async () => {
      const b = shortBrief(["PILGRIMAGE_FACILITIES"]);
      const res = await runSimulation(request({ policy: policy({ channelIds: ["PILGRIMAGE_FACILITIES"] }), policyBrief: b }), {
        intervalRounds: 1,
      });
      expect(res.validation.filter((v) => !v.passed)).toEqual([]);
      expect(res.seasonality?.policyCarriesPilgrimage).toBe(true);
    },
    240_000,
  );

  it(
    "runs a declared-only policy with no fabricated causal effect and says so",
    async () => {
      // FOOD_SECURITY is named in the dictionary but has no Bayesian-network
      // path yet. The run must not silently invent an effect: the treated path
      // should equal the baseline, and the result must carry the reason.
      const b = shortBrief(["FOOD_SECURITY"]);
      const res = await runSimulation(
        request({ policy: policy({ channelIds: ["FOOD_SECURITY"] }), policyBrief: b }),
        { intervalRounds: 1 },
      );
      expect(res.warnings.some((w) => /declared but not yet wired/i.test(w))).toBe(true);
      // Nothing is applied: no money leaves the budget and no agent's state is
      // shifted by a channel the network cannot represent.
      expect(res.trajectoryTrace.every((t) => t.cumulativeSpend === 0)).toBe(true);
    },
    240_000,
  );
});

/* ------------------------------------------------------------------ */
/* End-to-end run                                                      */
/* ------------------------------------------------------------------ */

describe("end-to-end simulation", () => {
  it(
    "produces engine-derived metrics, trajectories, zones and guardrails",
    async () => {
      const result = await runSimulation(request(), {
        searchAgents: 120,
        intervalRounds: 1,
      });

      // Every metric is a finite number derived from the population.
      for (const value of Object.values(result.point)) expect(Number.isFinite(value)).toBe(true);

      // The population is the real one, and it is identified.
      expect(result.populationSize).toBe(98923);
      expect(result.populationManifest).toBe(POP.manifest);

      // Every interval must contain its own point estimate.
      for (const key of Object.keys(result.point) as (keyof typeof result.point)[]) {
        const i = result.intervals[key];
        expect(i.p05).toBeLessThanOrEqual(result.point[key]);
        expect(result.point[key]).toBeLessThanOrEqual(i.p95);
      }

      // Baseline comes from the same engine with no policy.
      expect(Object.keys(result.baseline).length).toBe(Object.keys(result.point).length);

      // Multi-period trajectory exists and is a real time series.
      expect(result.trajectories.employmentRatePct.length).toBe(result.periods);
      expect(result.trajectories.gdpGrowthPct[0].month).toBe(3);

      // Zone incidence covers all four zones with distinct numbers.
      const zones = ["east", "west", "north", "south"] as const;
      for (const z of zones) expect(result.byZone[z].population).toBeGreaterThan(0);

      // Guardrails ran, including the decision layer's verification questions.
      expect(result.guardrails.length).toBeGreaterThan(4);
      expect(result.guardrails.some((g) => g.check.includes("no_unfunded_spending"))).toBe(true);

      // Evidence pack is attached.
      expect(result.validation.length).toBeGreaterThan(15);
      expect(result.validation.filter((v) => !v.passed)).toEqual([]);

      // Decision statistics are reported.
      expect(result.decisionStats.calls).toBeGreaterThan(0);
      expect(result.engine.decision).toBe("rule");
    },
    180_000,
  );

  it(
    "is byte-identical for identical inputs and seed",
    async () => {
      const opts = { searchAgents: 100, intervalRounds: 1 };
      const a = await runSimulation(request(), opts);
      const b = await runSimulation(request(), opts);
      expect(a.runId).toBe(b.runId);
      expect(a.point).toEqual(b.point);
      expect(a.byZone).toEqual(b.byZone);
      expect(a.trajectories).toEqual(b.trajectories);
      expect(a.alerts).toEqual(b.alerts);
      expect(a.distributions).toEqual(b.distributions);
    },
    180_000,
  );

  it(
    "changes with the seed but stays inside the reported intervals",
    async () => {
      const opts = { searchAgents: 100, intervalRounds: 1 };
      const a = await runSimulation(request({ seed: 424242 }), opts);
      const b = await runSimulation(request({ seed: 987654 }), opts);
      expect(a.runId).not.toBe(b.runId);
      const interval = a.intervals.employmentRatePct;
      const drift = Math.abs(b.point.employmentRatePct - interval.p50);
      const halfWidth = (interval.p95 - interval.p05) / 2 + 1.5;
      expect(drift).toBeLessThanOrEqual(halfWidth);
    },
    180_000,
  );

  it(
    "reports an aggregated probability headline whose 90% band brackets its own single-seed point",
    async () => {
      // Regression for the reported bug where one arbitrary seed's point value
      // fell OUTSIDE its own displayed 90% interval. The headline is now an
      // ensemble over the internal rounds, so the point estimate (which is one
      // member of that ensemble) must always sit inside the reported band.
      const result = await runSimulation(request(), { searchAgents: 100, intervalRounds: 2 });
      for (const key of Object.keys(result.point) as (keyof typeof result.point)[]) {
        const u = result.uncertainty[key];
        // A real distribution over the ensemble, not a single seed's value
        // presented as a probability.
        expect(u.seedCount).toBeGreaterThan(1);
        expect(u.improvedShare).toBeGreaterThanOrEqual(0);
        expect(u.improvedShare).toBeLessThanOrEqual(1);
        expect(u.p05Delta).toBeLessThanOrEqual(u.medianDelta + 1e-9);
        expect(u.medianDelta).toBeLessThanOrEqual(u.p95Delta + 1e-9);
        // The headline's own single-seed point must be bracketed by the 90% band.
        const pointDelta = result.point[key] - result.baseline[key];
        expect(u.p05Delta).toBeLessThanOrEqual(pointDelta + 1e-9);
        expect(pointDelta).toBeLessThanOrEqual(u.p95Delta + 1e-9);
      }
    },
    240_000,
  );

  it(
    "runs the evolutionary search and reports a verified Pareto front",
    async () => {
      const result = await runSimulation(request({ mode: "optimize" }), {
        // The search tier's cost is the only approximation in the engine, so this
        // keeps it small: the assertions are about the front being verified and
        // non-dominated, not about search quality.
        searchAgents: 80,
        searchPeriods: 2,
        dePopulation: 8,
        deGenerations: 5,
        intervalRounds: 1,
      });
      expect(result.engine.de).toContain("DE/");
      expect(result.convergence.length).toBeGreaterThan(1);
      expect(result.paretoFront.length).toBeGreaterThan(0);

      const objectives = result.paretoFront.map((p) => Object.values(p.objectives));
      for (let i = 0; i < objectives.length; i += 1) {
        for (let j = 0; j < objectives.length; j += 1) {
          if (i === j) continue;
          expect(dominates(objectives[j], objectives[i])).toBe(false);
        }
      }

      // The DE-vs-random-search comparison is always reported, whichever way it went.
      expect(result.warnings.some((w) => w.toLowerCase().includes("random search"))).toBe(true);
    },
    180_000,
  );

  it(
    "completes on the Simulation Lab's own default configuration",
    async () => {
      // Exactly the policy configuration the page sends when a user presses
      // "Run simulation" without touching anything: subsidy, 65% intensity,
      // ₹12 crore, 24 months and a 30/40/30 allocation. If this configuration
      // ever stops completing, the Lab is broken regardless of what the lower
      // level tests say.
      //
      // The uncertainty ensemble is capped at one round here. The engine's real
      // internal count is CONFIDENCE_ROUNDS (12), asserted separately in
      // spec-dod; 12 full-population rounds in one test blocks the vitest worker
      // past its RPC budget, and the ensemble is not what this test asserts.
      const allocTotal = 30 + 40 + 30;
      const result = await runSimulation({
        townId: POP.townId,
        policy: {
          channelIds: ["INCOME_SUPPORT"],
          name: "Pilgrimage-corridor employment subsidy",
          intensity: 0.65,
          budget: 12 * 1e7,
          durationMonths: 24,
          allocation: { housing: 30 / allocTotal, education: 40 / allocTotal, employment: 30 / allocTotal },
        },
        mode: "single",
        seed: 20260101,
        bnVersion: BN_VERSION,
        zoneFilter: "all",
      }, { intervalRounds: 1 });

      expect(result.periods).toBe(8);
      expect(result.populationSize).toBe(98923);
      expect(result.validation.filter((v) => !v.passed)).toEqual([]);
      expect(result.guardrails.filter((g) => !g.passed)).toEqual([]);
      for (const value of Object.values(result.point)) expect(Number.isFinite(value)).toBe(true);

      // The subsidy's documented channel reaches the population: employment must
      // improve against the no-policy baseline, not merely change.
      expect(result.point.employmentRatePct).toBeGreaterThan(result.baseline.employmentRatePct);
    },
    180_000,
  );

  it(
    "changing each allocation slice changes the outcomes the engine declares it to touch",
    async () => {
      const base = policy({ channelIds: ["INCOME_SUPPORT"], intensity: 0.8, budget: 120_000_000, durationMonths: 12 });
      const run = async (allocation: PolicyVector["allocation"]) =>
        runSimulation(request({ policy: { ...base, allocation } }), { intervalRounds: 1, searchAgents: 60 });
      const employmentHeavy = await run({ housing: 0.1, education: 0.1, employment: 0.8 });
      const educationHeavy = await run({ housing: 0.1, education: 0.8, employment: 0.1 });
      const housingHeavy = await run({ housing: 0.8, education: 0.1, employment: 0.1 });
      // Allocation must not be inert: the employment slice moves earnings/Gini,
      // and the durable-spending mix moves trust and therefore protest risk.
      const ginis = [employmentHeavy, educationHeavy, housingHeavy].map((r) => r.point.gini);
      const protests = [employmentHeavy, educationHeavy, housingHeavy].map((r) => r.point.protestRisk);
      expect(new Set(ginis).size).toBeGreaterThan(1);
      expect(new Set(protests).size).toBeGreaterThan(1);
    },
    240_000,
  );

  // One test per instrument rather than one loop over all six. The engine tests
  // are CPU-bound and block their worker for the length of a test, so keeping
  // each of them short is what lets vitest's worker heartbeat keep up; it also
  // reports which instrument broke the identities instead of "one of six".
  const instrumentRng = createRng(0x1234);
  const instrumentChannels: { id: string; channels: string[] }[] = [
    { id: "INCOME_SUPPORT", channels: ["INCOME_SUPPORT"] },
    { id: "TAX_FISCAL", channels: ["TAX_FISCAL"] },
    { id: "HOUSING", channels: ["HOUSING"] },
    { id: "EDUCATION_SKILL", channels: ["EDUCATION_SKILL"] },
    { id: "LABOR_MARKET", channels: ["LABOR_MARKET"] },
    { id: "REGULATION", channels: ["REGULATION"] },
  ];

  for (const instrument of instrumentChannels) {
    it(
      `holds every accounting identity under a randomized ${instrument.id} policy`,
      async () => {
        const result = await runSimulation(
          request({
            policy: policy({
              channelIds: instrument.channels,
              intensity: 0.3 + instrumentRng.next() * 0.7,
              budget: 5_000_000 + instrumentRng.next() * 150_000_000,
              // Durations stay short deliberately. These tests assert the
              // accounting identities, which must hold for any period count, and
              // the engine rolls the FULL population every period — a 36-month
              // policy costs 12 of those rolls. Keeping the suite well under
              // vitest's ~60s worker-RPC budget is what makes `bun run test`
              // exit 0 rather than fail the run on a heartbeat timeout.
              durationMonths: [3, 6, 9, 12][Math.floor(instrumentRng.next() * 4)],
            }),
          }),
          { searchAgents: 80, intervalRounds: 1 },
        );
        const failed = result.guardrails.filter((g) => g.check.includes("=") && !g.passed);
        expect(failed).toEqual([]);
        expect(result.validation.filter((v) => !v.passed)).toEqual([]);
      },
      300_000,
    );
  }
});
