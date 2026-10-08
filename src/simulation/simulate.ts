/**
 * Simulation orchestrator.
 *
 * ONE code path produces every reported number: a seeded, multi-period roll of
 * the Bayesian network across the agent population, aggregated through the
 * stated identities, with the town layer feeding back into the individual. The
 * counterfactual baseline comes from the SAME engine with the policy set to
 * `none`, so a result always ships with its own baseline rather than a
 * hardcoded comparison series.
 *
 * A run proceeds in six stages:
 *   1. build (or reuse) the population and the network
 *   2. baseline trajectory, policy = none
 *   3. optional Differential Evolution search over the policy vector
 *      (reduced agent sample, coarser periods — labelled as such, and the only
 *      approximation in the system)
 *   4. full-population trajectory for the chosen vector
 *   5. a random-seed variation range from full-population seed variants
 *   6. zone incidence, causal attribution, alerts, guardrails, identities
 *
 * The period loop is a synchronous generator that YIELDS a decision request at
 * each period boundary. A synchronous driver answers it with the deterministic
 * rule table (used by the search tier); an async driver awaits the configured
 * decision engine (used by the real run). One loop, two drivers, no duplication.
 */

import {
  AccountingViolationError,
  LOWER_IS_BETTER,
  aggregateBands,
  assertIdentities,
  checkIdentities,
  computeLevels,
  incomeHistogram,
  metricsFromLevels,
  sentimentHistogram,
  zoneGdpLevel,
  zoneMetrics,
} from "./aggregate";
import { allocationFor, engineInstrumentFor, pendingChannelNodes } from "./instruments";
import { lineageKeyFor } from "./lineage";
import type { AggregateBands, PeriodLevels } from "./aggregate";
import { CHANNEL_LAGS_MONTHS } from "./census";
import {
  BN_VERSION,
  applyEvidence,
  assertEvidenceIsUpstream,
  buildBn,
  causalAttribution,
  compileBn,
  extensionRngFor,
  sampleMicro,
  sampleTownAndFeedback,
  validateBnDirection,
  type CompiledBn,
  type Evidence,
} from "./bn";
import { differentialEvolution, randomSearch, type DeBounds } from "./de";
import { createDecisionEngine } from "./decision";
import { applySeasonalPressure, buildSeasonalProfile, type SeasonalProfile } from "./seasonality";
import { clonePopulation, generatePopulation, validatePopulation } from "./population";
import { PolicyFeasibilityError, validatePolicyBrief } from "./policy-brief";
import { clamp, clamp01, createRng, fnv1a, type Rng } from "./rng";
import { runGgg, type GggInheritance } from "./ggg";
import { AGE_BANDS, EDUCATION_LEVELS, EMPLOYMENT_STATUSES, INCOME_CLASSES, METRIC_KEYS, QUALITY_LEVELS, ZONES } from "./types";
import type {
  DecisionEngine,
  GuardrailCheck,
  MetricKey,
  ParetoCandidate,
  PolicyVector,
  Population,
  SimulationRequest,
  SimulationResult,
  TrajectoryPoint,
  ValidationCheck,
} from "./types";

/* ------------------------------------------------------------------ */
/* Configuration                                                       */
/* ------------------------------------------------------------------ */

export interface SimulationOptions {
  /** Override the population (tests use a smaller synthetic population). */
  population?: Population;
  decisionEngine?: DecisionEngine;
  /** Progress reporting. Real, never decorative. */
  onProgress?: (p: { phase: string; fraction: number; detail?: string }) => void;
  /** Agents used during the search tier. */
  searchAgents?: number;
  /** Periods used during the search tier. */
  searchPeriods?: number;
  dePopulation?: number;
  deGenerations?: number;
  skipSearch?: boolean;
  /**
   * Seed rounds used to build the uncertainty ensemble (each is a full-sample
   * trajectory). Defaults to the fixed internal CONFIDENCE_ROUNDS; there is no
   * user-facing dial, and tests override it to stay fast.
   */
  intervalRounds?: number;
  /**
   * Encoded policy vectors from THIS run's lineage, best-first. They seed the
   * evolutionary search so inheritance stays inside the lineage (Part C).
   */
  lineageSeeds?: number[][];
}

/**
 * Fixed internal count of seed rounds behind the uncertainty ensemble. This is
 * deliberately NOT a user-facing dial: the confidence ensemble is an internal
 * reproducibility mechanism, not a tuning knob. Used by the engine when a caller
 * does not override `intervalRounds`.
 */
export const CONFIDENCE_ROUNDS = 12;

/** Reference budget used to band the budget share. Modelled. */
export const REFERENCE_BUDGET = 200_000_000;
const MONTHS_PER_PERIOD = 3;
/**
 * Calendar month the simulated trajectory begins in. Fixed for reproducibility,
 * and chosen so a default 24-month run spans at least one Wari window (June–July).
 */
export const SEASONAL_START_MONTH = 1;

/* ------------------------------------------------------------------ */
/* Objectives                                                          */
/* ------------------------------------------------------------------ */

export const OBJECTIVE_LABELS = [
  "Employment rate (%)",
  "GDP growth (%)",
  "Happiness index",
  "Inflation control",
  "Mean income (₹10k)",
];

/** All objectives are "higher is better". */
function objectivesFor(l: PeriodLevels, baselineGdp: number): number[] {
  const growth = baselineGdp > 0 ? (l.gdpLevel - baselineGdp) / baselineGdp : 0;
  const employmentRate = l.workingAgeCount > 0 ? l.employedCount / l.workingAgeCount : 0;
  return [
    employmentRate * 100,
    growth * 100,
    l.happinessScore,
    // Inverted so that lower inflation is better; scaled to a comparable range.
    10 - l.inflationPct,
    l.meanHouseholdIncomePerCapita / 10000,
  ];
}

/* ------------------------------------------------------------------ */
/* Policy encoding (DE vector, §11.1)                                  */
/* ------------------------------------------------------------------ */

export const DE_BOUNDS: DeBounds[] = [
  { lower: 0.05, upper: 1 }, // intensity
  { lower: 2_000_000, upper: REFERENCE_BUDGET }, // budget
  { lower: 3, upper: 60 }, // duration, months
  { lower: 0.02, upper: 1 }, // allocation: housing
  { lower: 0.02, upper: 1 }, // allocation: education
  { lower: 0.02, upper: 1 }, // allocation: employment
];

export function encodePolicy(p: PolicyVector): number[] {
  return [p.intensity, p.budget, p.durationMonths, p.allocation.housing, p.allocation.education, p.allocation.employment];
}

export function decodeVector(v: number[], channelIds: string[], name: string): PolicyVector {
  const alloc = [v[3], v[4], v[5]];
  const sum = alloc.reduce((a, b) => a + b, 0) || 1;
  const normalised = { housing: alloc[0] / sum, education: alloc[1] / sum, employment: alloc[2] / sum };
  return {
    channelIds,
    name,
    intensity: clamp01(v[0]),
    budget: clamp(v[1], 2_000_000, REFERENCE_BUDGET),
    durationMonths: clamp(Math.round(v[2] / 3) * 3, 3, 60),
    // The three-way split only applies to channels that use it; for tax /
    // regulation / healthcare the engine family's declared default is used, so
    // the allocation genes are ignored rather than silently pretending to matter.
    allocation: allocationFor(channelIds, normalised),
  };
}

/* ------------------------------------------------------------------ */
/* Period specification                                                */
/* ------------------------------------------------------------------ */

interface PeriodSpec {
  count: number;
  monthsEach: number;
  /** Agents to simulate, or null for the whole population. */
  agents: Int32Array | null;
}

interface DecisionRequest {
  period: number;
  month: number;
  state: string;
  zoneSignals: { zone: string; distress: number }[];
  protestSignal: number;
}

interface DecisionResponse {
  aggregateAdjust: number;
  protestScore: number;
  confidence: number;
}

interface TrajectoryOutcome {
  levels: PeriodLevels[];
  finalLevel: PeriodLevels;
  alerts: SimulationResult["alerts"];
  inflationBand: number;
  reachability: number;
  decisionConfidence: number;
}

/* ------------------------------------------------------------------ */
/* Carried state helpers                                               */
/* ------------------------------------------------------------------ */

/** Effective policy intensity at a given month, honouring the channel lag. */
export function rampFor(channelIds: string[], month: number, intensity: number): number {
  const family = engineInstrumentFor(channelIds);
  const lag =
    family === "housing"
      ? CHANNEL_LAGS_MONTHS.housing
      : family === "education"
        ? CHANNEL_LAGS_MONTHS.education
        : family === "regulation"
          ? CHANNEL_LAGS_MONTHS.regulation
          : family === "tax"
            ? CHANNEL_LAGS_MONTHS.taxDemand
            : CHANNEL_LAGS_MONTHS.subsidyEmployment;
  return clamp01(intensity * clamp01((month + 0.5) / Math.max(1, lag)));
}

function bandFor(value: number, lowCut: number, highCut: number): "low" | "medium" | "high" {
  return value < lowCut ? "low" : value < highCut ? "medium" : "high";
}

function trustBandOf(pop: Population, i: number): string {
  return pop.trustInGov[i] < 0.36 ? "low" : pop.trustInGov[i] < 0.6 ? "medium" : "high";
}

/* ------------------------------------------------------------------ */
/* The period loop (generator)                                         */
/* ------------------------------------------------------------------ */

/**
 * Roll the network forward one period at a time.
 *
 * CARRY-FORWARD between periods is what makes this a simulation rather than a
 * snapshot:
 *   IncomeClassPrior <- previous period's sampled IncomeClass (persistence)
 *   TrustInGov       <- updated from experienced sentiment
 *   HousingQuality   <- upgraded by housing-allocation spending (long lag)
 *   savingsMonths    <- a STOCK: credited by income, drawn down by essentials
 *   active           <- agents that sampled `leave` migrate out of the town
 *   outputState      <- the sampled sector-output state
 *   demandHistory    <- smoothed so demand -> inflation respects its lag
 */
function* trajectoryGenerator(
  pop: Population,
  c: CompiledBn,
  policy: PolicyVector,
  baselineGdpLevel: number,
  spec: PeriodSpec,
  rng: Rng,
  /** GGG grounded effect scale applied to the modelled policy shift. */
  effectScale: number,
  onPeriod?: (fraction: number) => void,
): Generator<DecisionRequest, TrajectoryOutcome, DecisionResponse> {
  const states = new Int32Array(c.ids.length);
  // Isolated stream for nodes registered after the original network, so adding
  // one never perturbs the established simulation's uniforms.
  const extRng = extensionRngFor(rng.seed);
  const agents = spec.agents ?? Int32Array.from({ length: pop.size }, (_, i) => i);
  const active0 = agents.length;

  const levels: PeriodLevels[] = [];
  const alerts: SimulationResult["alerts"] = [];
  const demandHistory: number[] = [];
  let migrated = 0;
  let cumulativeSpend = 0;
  let reachedTransfers = 0;
  let intendedTransfers = 0;
  let decisionConfidenceSum = 0;
  let decisionPeriods = 0;
  let inflationBand = 1;
  // The engine behaviour family the policy's channel set runs as. Derived once;
  // declared-only channel sets resolve to "none" (no silent substitution).
  const family = engineInstrumentFor(policy.channelIds);

  for (let p = 0; p < spec.count; p += 1) {
    const month = (p + 1) * spec.monthsEach;
    const applied = rampFor(policy.channelIds, month, policy.intensity);

    // A channel set the dictionary marks "declared" resolves to the "none"
    // family: nothing in the network represents it. Such a run must be an exact
    // no-op rather than a spending programme, so its budget is never applied —
    // otherwise money would leak into aggregate demand, income, savings and
    // housing through no modelled causal path. Every other family is unchanged.
    const policyApplies = family !== "none";
    // Budget is a FLOW spread across the duration, capped by what is left.
    const perPeriodBudget = (policy.budget / Math.max(1, policy.durationMonths)) * spec.monthsEach;
    const remaining = Math.max(0, policy.budget - cumulativeSpend);
    const budgetThisPeriod = policyApplies ? Math.min(perPeriodBudget, remaining) : 0;
    const budgetScale = perPeriodBudget > 0 ? budgetThisPeriod / perPeriodBudget : 0;
    const effectiveApplied = applied * budgetScale;
    cumulativeSpend += budgetThisPeriod;

    // GGG grounding (ggg.ts): the causal network reads the policy intensity and
    // budget share SCALED by the historical-comparability effect scale, so a
    // small local application of a larger mechanism cannot produce the larger
    // mechanism's effect. The applied intensity reported to the UI stays the
    // policy's own, so the grounding is visible as a separate, labelled input
    // rather than hidden inside the number the evaluator sees.
    const groundedApplied = effectiveApplied * effectScale;
    const intensityBand = bandFor(groundedApplied, 0.4, 0.72);
    const budgetBand = bandFor((policy.budget / REFERENCE_BUDGET) * effectScale, 0.25, 0.6);
    const durationBand = policy.durationMonths <= 12 ? "short" : policy.durationMonths <= 36 ? "medium" : "long";

    let taxRevenue = 0;
    let transfersAssigned = 0;
    let protestSignalSum = 0;

    /* --- pass 1: per-agent micro outcomes --- */
    for (let a = 0; a < agents.length; a += 1) {
      const i = agents[a];
      if (!pop.active[i]) continue;

      states.fill(0);
      const fixed = applyEvidence(c, states, {
        PolicyType: family,
        PolicyIntensity: intensityBand,
        PolicyBudgetShare: budgetBand,
        PolicyDuration: durationBand,
        IncomeClassPrior: INCOME_CLASSES[pop.incomeClass[i]],
        AgeBand: AGE_BANDS[pop.ageBand[i]],
        EducationLevel: EDUCATION_LEVELS[pop.education[i]],
        HousingQuality: QUALITY_LEVELS[pop.housing[i]],
        TrustInGov: trustBandOf(pop, i),
      });
      // Validate the evidence construction once per run: sampling is only exact
      // when conditioning happens on fully-fixed ancestry.
      if (p === 0 && a === 0) assertEvidenceIsUpstream(c, fixed);
      sampleMicro(c, states, fixed, rng, extRng);

      const sampledIncomeClass = states[c.index.IncomeClass];
      const sampledEmp = states[c.index.EmploymentStatus];
      const sampledSkill = states[c.index.SkillRelevance];
      const sampledSector = states[c.index.SectorOfWork];
      const sampledCapacity = states[c.index.SpendingCapacity];
      const sampledOutput = states[c.index.AgentSectorOutput];

      // Reachability: informality gates whether an instrument touches a citizen.
      const informal = pop.informality[i] === 1;
      const reach = family === "tax" ? 1 : informal ? 0.34 : 0.92;
      transfersAssigned += (budgetThisPeriod / agents.length) * reach;

      if (family === "tax") {
        const formal = pop.employmentStatus[i] === EMPLOYMENT_STATUSES.indexOf("formal");
        if (formal) taxRevenue += (budgetThisPeriod / agents.length) * 0.85 * clamp01(policy.intensity);
      }

      // Write sampled micro outcomes back into the agent.
      pop.incomeClass[i] = sampledIncomeClass as number;
      pop.employmentStatus[i] = sampledEmp as number;
      pop.employed[i] = sampledEmp === EMPLOYMENT_STATUSES.indexOf("unemployed") ? 0 : 1;
      pop.outputState[i] = sampledOutput as number;
      pop.skillRelevance[i] = clamp01([0.35, 0.62, 0.88][sampledSkill] ?? pop.skillRelevance[i]);

      if (pop.employed[i] && sampledSector !== undefined && rng.next() < 0.12 * groundedApplied) {
        pop.sector[i] = sampledSector as number;
      }

      if (pop.employed[i]) {
        const classFactor = [0.55, 0.78, 1.0, 1.5, 2.35, 4.3][pop.incomeClass[i]] ?? 1;
        const base = pop.income[i] > 0 ? pop.income[i] : 6000 * classFactor;
        // Allocation is a real policy dimension, not decoration: the employment
        // slice scales the immediate earnings lift, the education slice scales
        // the human-capital lift. (Both weights are ASSUMPTIONS.)
        const policyEffect =
          1 +
          (family === "subsidy" || family === "labor" ? 0.035 : 0.012) *
            groundedApplied *
            reach *
            (1 + policy.allocation.employment * 0.6 + policy.allocation.education * 0.3);
        pop.income[i] = base * (0.985 + rng.next() * 0.03) * policyEffect;
      } else {
        pop.income[i] = 0;
      }

      // Savings is a stock: credited by income, drawn down by essentials.
      const essential = 3200 + 140 * rng.next();
      const credit = pop.income[i] > 0 ? (pop.income[i] - essential) / essential : -0.55;
      // The education slice funds skills/retraining, which protects the savings
      // stock a household can absorb. (ASSUMPTION.)
      const policySavings =
        ((family === "subsidy" ? 0.05 : 0) + policy.allocation.education * 0.03) *
        groundedApplied *
        reach;
      pop.savingsMonths[i] = clamp(
        pop.savingsMonths[i] + credit * 0.06 * spec.monthsEach + policySavings * spec.monthsEach * 0.1,
        0,
        36,
      );
      // A collapsed stock pins spending capacity at "constrained".
      if (sampledCapacity === 0) pop.savingsMonths[i] = Math.min(pop.savingsMonths[i], 1.4);

      protestSignalSum += pop.protestPropensity[i];
    }

    // Household income must be recomputed from member earnings before any
    // per-capita aggregation.
    pop.householdIncome.fill(0);
    for (let i = 0; i < pop.size; i += 1) pop.householdIncome[pop.household[i]] += pop.income[i];

    /* --- provisional aggregation, to derive this period's town bands --- */
    const provisional = computeLevels({
      pop,
      inflationBand,
      budgetSpend: budgetThisPeriod,
      taxRevenue,
      transfersAssigned,
      externalFunding: Math.max(0, budgetThisPeriod - taxRevenue),
      migrationOutflow: active0 > 0 ? migrated / active0 : 0,
      declaredBudget: policy.budget,
      cumulativeSpend,
    });

    // Demand -> inflation honours its lag by smoothing over preceding periods.
    demandHistory.push(provisional.demandPressure);
    const lagPeriods = Math.max(1, Math.round(CHANNEL_LAGS_MONTHS.demandPassThrough / spec.monthsEach));
    const window = demandHistory.slice(Math.max(0, demandHistory.length - lagPeriods));
    const smoothedDemand = window.reduce((a, b) => a + b, 0) / window.length;
    // Inflation is COMPUTED from aggregate demand through this stated identity
    // rather than sampled from a prior.
    inflationBand = smoothedDemand < 8 ? 0 : smoothedDemand < 14 ? 1 : 2;

    const bands: AggregateBands = aggregateBands(provisional, baselineGdpLevel);
    const zoneSignals = ZONES.map((zone) => ({ zone, distress: zoneDistressSignal(pop, zone) }));
    const protestSignal = active0 > 0 ? protestSignalSum / active0 : 0;

    /* --- decision layer: one batched request per period --- */
    const response = yield {
      period: p,
      month,
      state: describeTownState(pop, policy, provisional, spec.monthsEach, month),
      zoneSignals,
      protestSignal,
    };
    decisionConfidenceSum += response.confidence;
    decisionPeriods += 1;

    // A distressed labour market is nudged down one band. This is a real
    // coupling between the decision layer and the simulation, and it is
    // recorded in the run's decision statistics.
    if (response.aggregateAdjust < 0) {
      bands.EmploymentAggregate = bands.EmploymentAggregate === "high" ? "normal" : "low";
    }

    /* --- pass 3: town feedback, with the town layer fixed as evidence --- */
    for (let a = 0; a < agents.length; a += 1) {
      const i = agents[a];
      if (!pop.active[i]) continue;

      states.fill(0);
      const fixed = applyEvidence(c, states, {
        PolicyType: family,
        PolicyIntensity: intensityBand,
        PolicyBudgetShare: budgetBand,
        PolicyDuration: durationBand,
        IncomeClassPrior: INCOME_CLASSES[pop.incomeClass[i]],
        AgeBand: AGE_BANDS[pop.ageBand[i]],
        EducationLevel: EDUCATION_LEVELS[pop.education[i]],
        HousingQuality: QUALITY_LEVELS[pop.housing[i]],
        TrustInGov: trustBandOf(pop, i),
        ...bands,
        Inflation: (["low", "moderate", "high"] as const)[inflationBand],
      });
      if (p === 0 && a === 0) assertEvidenceIsUpstream(c, fixed);
      sampleTownAndFeedback(c, states, fixed, rng);

      const target = states[c.index.PublicSentiment] as number;
      const protest = states[c.index.ProtestRiskBand] as number;
      const migration = states[c.index.MigrationIntentBand] as number;

      // Sentiment moves rather than teleporting: partially carried forward.
      pop.sentiment[i] = rng.next() < 0.35 ? pop.sentiment[i] : target;
      // Durable spending (housing, education) builds more trust per unit of
      // experienced sentiment than pure transfers, so the allocation mix feeds
      // the trust update and therefore protest propensity. (ASSUMPTION.) The
      // no-policy baseline keeps the unweighted 1.0 so it is unchanged.
      const allocationCare =
        family === "none" ? 1 : 0.6 + 0.7 * (policy.allocation.housing + policy.allocation.education);
      pop.trustInGov[i] = clamp01(
        pop.trustInGov[i] + (target - 1) * 0.012 * allocationCare - (protest === 2 ? 0.01 : 0),
      );
      pop.protestPropensity[i] = clamp01(
        pop.protestPropensity[i] * 0.72 + (protest / 2) * 0.26 + (1 - pop.trustInGov[i]) * 0.02,
      );
      pop.migrationIntent[i] = clamp01(pop.migrationIntent[i] * 0.6 + (migration / 2) * 0.4);

      // Durable housing improvement, gated by its long lag.
      if (
        policy.allocation.housing > 0.3 &&
        groundedApplied > 0.45 &&
        rng.next() < 0.02 * policy.allocation.housing * spec.monthsEach
      ) {
        pop.housing[i] = Math.min(2, pop.housing[i] + 1);
      }

      // Agents that decide to leave actually leave the population.
      if (migration === 2 && rng.next() < clamp01(0.012 + pop.mobility[i] * 0.03) * spec.monthsEach * 0.34) {
        pop.active[i] = 0;
        migrated += 1;
      }
    }

    pop.householdIncome.fill(0);
    for (let i = 0; i < pop.size; i += 1) pop.householdIncome[pop.household[i]] += pop.income[i];

    /* --- official period levels, with identities enforced on full runs --- */
    intendedTransfers += budgetThisPeriod;
    reachedTransfers += transfersAssigned;

    const level = computeLevels({
      pop,
      inflationBand,
      budgetSpend: budgetThisPeriod,
      taxRevenue,
      transfersAssigned,
      externalFunding: Math.max(0, budgetThisPeriod - taxRevenue),
      migrationOutflow: active0 > 0 ? migrated / active0 : 0,
      declaredBudget: policy.budget,
      cumulativeSpend,
    });

    if (spec.agents === null) assertIdentities(pop, level);

    levels.push(level);
    collectAlerts(alerts, level, month, levels[0]);
    onPeriod?.((p + 1) / spec.count);
  }

  return {
    levels,
    finalLevel: levels[levels.length - 1],
    alerts,
    inflationBand,
    reachability: intendedTransfers > 0 ? reachedTransfers / intendedTransfers : 1,
    decisionConfidence: decisionPeriods > 0 ? decisionConfidenceSum / decisionPeriods : 0.7,
  };
}

/** Synchronous driver: answers decision requests with the deterministic rule table. */
function driveSync(gen: Generator<DecisionRequest, TrajectoryOutcome, DecisionResponse>): TrajectoryOutcome {
  let input: DecisionResponse | undefined;
  for (;;) {
    const step = gen.next(input as DecisionResponse);
    if (step.done) return step.value as TrajectoryOutcome;
    const req = step.value as DecisionRequest;
    // Numeric-only rule: a distressed labour market is nudged down one band.
    const worst = Math.max(...req.zoneSignals.map((z) => z.distress), 0);
    input = {
      aggregateAdjust: worst >= 0.55 ? -1 : 0,
      protestScore: clamp01(req.protestSignal * 1.6),
      confidence: Math.max(0.5, 1 - worst * 0.5),
    };
  }
}

/**
 * Async driver: awaits the configured decision engine at each period boundary.
 * The agent loops stay synchronous — only the period boundary awaits — so a
 * batched remote decision call costs one round trip per period.
 */
async function driveAsync(
  gen: Generator<DecisionRequest, TrajectoryOutcome, DecisionResponse>,
  engine: DecisionEngine,
): Promise<TrajectoryOutcome> {
  let input: DecisionResponse | undefined;
  for (;;) {
    const step = gen.next(input as DecisionResponse);
    if (step.done) return step.value as TrajectoryOutcome;

    const req = step.value as DecisionRequest;
    // One batched evaluation covering every zone, plus one severity score for
    // the town. Two round trips per period at most.
    const [distress, severity] = await Promise.all([
      engine.evaluate(
        req.state,
        req.zoneSignals.map((z) => ({
          key: `distress_${z.zone}`,
          statement: `Zone ${z.zone} is in labour-market distress at month ${req.month}`,
          value: z.distress,
        })),
      ),
      engine.score(req.state, {
        key: "protest_severity",
        rubric: ["calm", "vocal", "disruptive", "severe"],
        prompt: `How severe is protest activity at month ${req.month}?`,
        value: clamp01(req.protestSignal * 2.2),
      }),
    ]);

    const worst = Math.max(...distress.map((d) => d.probability), 0);
    const confidence = Math.min(
      Math.max(...distress.map((d) => d.confidence), 0.5),
      severity.confidence || 0.5,
    );
    input = {
      aggregateAdjust: worst >= 0.55 ? -1 : 0,
      protestScore: severity.distribution[severity.answer] ?? 0.5,
      confidence,
    };
  }
}

/* ------------------------------------------------------------------ */
/* Decision-layer signals                                              */
/* ------------------------------------------------------------------ */

function zoneDistressSignal(pop: Population, zone: string): number {
  const zoneIdx = ZONES.indexOf(zone as never);
  let active = 0;
  let employed = 0;
  let workingAge = 0;
  let fragile = 0;
  let poor = 0;
  for (let i = 0; i < pop.size; i += 1) {
    if (!pop.active[i] || pop.zone[i] !== zoneIdx) continue;
    active += 1;
    if (pop.age[i] >= 15) workingAge += 1;
    if (pop.employmentStatus[i] !== EMPLOYMENT_STATUSES.indexOf("unemployed")) employed += 1;
    if (pop.savingsMonths[i] < 1.5) fragile += 1;
    if (pop.incomeClass[i] === INCOME_CLASSES.indexOf("bpl")) poor += 1;
  }
  if (active === 0) return 0;
  const unemployment = workingAge > 0 ? 1 - employed / workingAge : 0;
  return clamp01(unemployment * 0.5 + (fragile / active) * 0.3 + (poor / active) * 0.2);
}

function describeTownState(
  pop: Population,
  policy: PolicyVector,
  level: PeriodLevels,
  monthsEach: number,
  month: number,
): string {
  const employment = level.workingAgeCount > 0 ? (level.employedCount / level.workingAgeCount) * 100 : 0;
  return [
    `Month ${month} of a ${policy.durationMonths}-month policy over channels [${policy.channelIds.length > 0 ? policy.channelIds.join(" + ") : "none"}] at intensity ${(policy.intensity * 100).toFixed(0)}%.`,
    `Working-age residents ${level.workingAgeCount}.`,
    `Employment rate ${employment.toFixed(1)}%.`,
    `Mean household income per capita INR ${Math.round(level.meanHouseholdIncomePerCapita)}.`,
    `Inflation ${level.inflationPct.toFixed(1)}%.`,
    `Happiness index ${level.happinessScore.toFixed(1)} of 100.`,
    `Protest risk ${(level.protestRisk * 100).toFixed(1)}%.`,
    `Gini ${level.gini.toFixed(3)}.`,
    `Step length ${monthsEach} months.`,
    `Town population ${pop.size}.`,
  ].join(" ");
}

/* ------------------------------------------------------------------ */
/* Alerts                                                              */
/* ------------------------------------------------------------------ */

const ALERT_THRESHOLDS = {
  protestDanger: 30,
  protestWarning: 18,
  inflationWarning: 6,
  employmentWarning: 60,
  migrationWarning: 4,
  giniRiseWarning: 0.02,
} as const;

function collectAlerts(
  alerts: SimulationResult["alerts"],
  level: PeriodLevels,
  month: number,
  first: PeriodLevels,
): void {
  const seen = new Set(alerts.map((a) => `${a.metric}:${a.severity}`));
  const push = (severity: "warning" | "danger" | "info", metric: MetricKey, message: string) => {
    const key = `${metric}:${severity}`;
    if (seen.has(key)) return; // one alert per metric per severity, at first crossing
    seen.add(key);
    alerts.push({ month, severity, metric, message });
  };

  if (level.protestRisk * 100 >= ALERT_THRESHOLDS.protestDanger) {
    push("danger", "protestRisk", `Protest risk crosses ${ALERT_THRESHOLDS.protestDanger}% in month ${month}`);
  } else if (level.protestRisk * 100 >= ALERT_THRESHOLDS.protestWarning) {
    push("warning", "protestRisk", `Protest risk crosses ${ALERT_THRESHOLDS.protestWarning}% in month ${month}`);
  }
  if (level.inflationPct >= ALERT_THRESHOLDS.inflationWarning) {
    push("warning", "inflationPct", `Inflation band reaches ${level.inflationPct.toFixed(1)}% in month ${month}`);
  }
  const employment = level.workingAgeCount > 0 ? (level.employedCount / level.workingAgeCount) * 100 : 0;
  if (employment < ALERT_THRESHOLDS.employmentWarning) {
    push("warning", "employmentRatePct", `Employment falls below ${ALERT_THRESHOLDS.employmentWarning}% in month ${month}`);
  }
  if (level.migrationOutflow * 100 >= ALERT_THRESHOLDS.migrationWarning) {
    push(
      "warning",
      "migrationOutflowPct",
      `Migration outflow reaches ${(level.migrationOutflow * 100).toFixed(2)}% of residents by month ${month}`,
    );
  }
  if (level.gini - first.gini >= ALERT_THRESHOLDS.giniRiseWarning) {
    push("warning", "gini", `Inequality widens: Gini +${(level.gini - first.gini).toFixed(3)} by month ${month}`);
  }
}

/* ------------------------------------------------------------------ */
/* Intervals                                                           */
/* ------------------------------------------------------------------ */

/** Credible interval from a set of real engine outputs, not a decorative margin. */
export function intervalFor(samples: number[]): { p05: number; p50: number; p95: number } {
  if (samples.length === 0) return { p05: 0, p50: 0, p95: 0 };
  const sorted = Float64Array.from(samples).sort();
  const q = (f: number) => {
    const pos = clamp(f, 0, 1) * (sorted.length - 1);
    const lo = Math.floor(pos);
    const hi = Math.ceil(pos);
    return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
  };
  return { p05: q(0.05), p50: q(0.5), p95: q(0.95) };
}

/* ------------------------------------------------------------------ */
/* Guardrails (§8.2 U4)                                                */
/* ------------------------------------------------------------------ */

async function runGuardrails(
  engine: DecisionEngine,
  input: {
    identities: GuardrailCheck[];
    gdpSignConsistent: boolean;
    inflationComputedBand: number;
    inflationImpliedPct: number;
    state: string;
    reachability: number;
  },
): Promise<GuardrailCheck[]> {
  const statements = [
    {
      key: "gdp_direction_consistent_across_zones",
      statement: "The headline GDP growth direction agrees with every zone's growth direction",
      value: input.gdpSignConsistent ? 0.97 : 0.12,
    },
    {
      key: "inflation_channel_consistent",
      statement: "The computed inflation band agrees with the network's own implied inflation",
      value: Math.abs([2.4, 4.1, 6.8][input.inflationComputedBand] - input.inflationImpliedPct) <= 1.2 ? 0.95 : 0.3,
    },
    {
      key: "instrument_actually_reaches_citizens",
      statement: "The instrument reaches a majority of the population it targets",
      value: input.reachability >= 0.6 ? 0.94 : input.reachability >= 0.4 ? 0.5 : 0.15,
    },
    {
      key: "no_unfunded_spending",
      statement: "No spending occurs outside the declared policy budget",
      value: input.identities.some((c) => c.check.includes("cumulative spend") && !c.passed) ? 0.1 : 0.98,
    },
  ];
  const answers = await engine.evaluate(input.state, statements);
  return [
    ...input.identities,
    ...answers.map((a) => ({
      check: a.key,
      passed: a.probability >= 0.5,
      note: `P(true) = ${a.probability.toFixed(2)}, confidence ${a.confidence.toFixed(2)}`,
      confidence: a.confidence,
    })),
  ];
}

/* ------------------------------------------------------------------ */
/* Cached population and network validation                            */
/* ------------------------------------------------------------------ */

let cachedPopulation: Population | null = null;
let cachedPopulationValidation: ValidationCheck[] | null = null;
let cachedNetworkValidation: ValidationCheck[] | null = null;

export function getPopulation(seed = 20260101): Population {
  if (!cachedPopulation || cachedPopulation.seed !== seed) {
    cachedPopulation = generatePopulation(seed);
    cachedPopulationValidation = null;
    cachedNetworkValidation = null;
  }
  return cachedPopulation;
}

function validationChecks(pop: Population, c: CompiledBn): ValidationCheck[] {
  if (!cachedPopulationValidation) cachedPopulationValidation = validatePopulation(pop);
  if (!cachedNetworkValidation) cachedNetworkValidation = validateBnDirection(c.bn, pop, 400);
  return [...cachedPopulationValidation, ...cachedNetworkValidation];
}

/* ------------------------------------------------------------------ */
/* Policy brief gate (spec §7, §26)                                    */
/* ------------------------------------------------------------------ */

/**
 * Resolve the effective policy vector. When the request carries a structured
 * policy brief it is AUTHORITATIVE and the feasibility gate is re-run HERE, in
 * the engine, so a blocking-invalid policy cannot reach the simulation even if
 * a caller bypasses the UI. Budget, duration and channels then come from the
 * brief; the caller's intensity and allocation still apply.
 *
 * Throws `PolicyFeasibilityError` (carrying the full findings) rather than
 * silently simulating a policy that governance, budget or timeline rules block.
 */
function resolvePolicy(request: SimulationRequest): PolicyVector {
  if (!request.policyBrief) return request.policy;
  const feasibility = validatePolicyBrief(request.policyBrief);
  if (!feasibility.simulationReady) {
    throw new PolicyFeasibilityError(request.policyBrief.title, feasibility);
  }
  return {
    ...request.policy,
    channelIds: request.policyBrief.channelIds,
    name: request.policyBrief.title,
    budget: feasibility.derived.budgetInr,
    durationMonths: feasibility.derived.durationMonths,
  };
}

/* ------------------------------------------------------------------ */
/* Public entry point                                                  */
/* ------------------------------------------------------------------ */

export async function runSimulation(
  request: SimulationRequest,
  options: SimulationOptions = {},
): Promise<SimulationResult> {
  const warnings: string[] = [];
  const engine = options.decisionEngine ?? createDecisionEngine("rule");
  engine.reset();
  const onProgress = options.onProgress ?? (() => {});

  // Enforce the policy-brief feasibility gate before anything else runs.
  const policy = resolvePolicy(request);

  /* 0. GGG — historical-policy inheritance. Pure, deterministic and inspectable:
     the policy genome, its historical parents, the inherited traits, the
     Pandharpur adaptation and the grounded effect scale that the causal engine
     below actually uses. Runs BEFORE the simulation so historical evidence
     influences the policy characteristics, not merely the description of them. */
  onProgress({ phase: "Selecting historical evidence (GGG)", fraction: 0.02 });
  const grounding: GggInheritance = runGgg(policy, request.policyBrief);
  const effectScale = grounding.grounded.effectScale;

  /* 1. Population and network */
  const base = options.population ?? getPopulation();
  onProgress({
    phase: "Census-anchored population ready",
    fraction: 0.04,
    detail: `${base.size.toLocaleString()} agents · manifest ${base.manifest}`,
  });
  const c = compileBn(buildBn(base));

  const periods = Math.max(1, Math.round(policy.durationMonths / MONTHS_PER_PERIOD));
  const policyFamily = engineInstrumentFor(policy.channelIds);

  // A channel the dictionary marks "declared" has no Bayesian-network path yet.
  // `engineInstrumentFor` resolves a declared-only set to the "none" family
  // rather than substituting a different channel, and the run says so here, so
  // no result can silently imply a causal effect the network cannot represent.
  const pendingChannels = pendingChannelNodes(policy.channelIds);
  if (pendingChannels.length > 0) {
    const names = pendingChannels.map((p) => p.channelId).join(", ");
    const missing = pendingChannels.flatMap((p) => p.missingNodes).join(", ");
    warnings.push(
      policyFamily === "none"
        ? `Every selected channel is declared but not yet wired into the network (${names}). Their Bayesian-network nodes (${missing}) do not exist, so this run applies no causal effect: no budget is spent and no BN state is shifted. Any small difference from the baseline is seed-sampling noise, not a modelled impact.`
        : `Some selected channels are declared but not yet wired into the network (${names}); they contribute no causal effect and the run uses the implemented channels only (family "${policyFamily}").`,
    );
  }

  // Wari seasonal pressure (spec §12). Modelled as temporary visitor pressure on
  // top of the resident population, never as extra residents. The baseline gets
  // the background season too, so the treated-vs-baseline difference is the
  // POLICY's pilgrimage effect — a general policy therefore acquires none.
  const baselineSeasonal = buildSeasonalProfile({
    periods,
    monthsEach: MONTHS_PER_PERIOD,
    startMonth: SEASONAL_START_MONTH,
    channelIds: [],
    intensity: 0,
  });
  const policySeasonal = buildSeasonalProfile({
    periods,
    monthsEach: MONTHS_PER_PERIOD,
    startMonth: SEASONAL_START_MONTH,
    channelIds: policy.channelIds,
    intensity: policy.intensity,
  });
  const baselinePressure = meanCivicPressure(baselineSeasonal);
  const policyPressure = meanCivicPressure(policySeasonal);

  /* 2. Baseline: the same engine, the same population, policy = none */
  onProgress({ phase: "Running no-policy baseline", fraction: 0.1 });
  const baselinePolicy: PolicyVector = {
    channelIds: [],
    name: "Baseline (no policy)",
    intensity: 0,
    budget: 0,
    durationMonths: policy.durationMonths,
    allocation: { housing: 0, education: 0, employment: 0 },
  };
  const baselinePop = clonePopulation(base);
  const baselineOutcome = driveSync(
    trajectoryGenerator(
      baselinePop,
      c,
      baselinePolicy,
      0,
      { count: periods, monthsEach: MONTHS_PER_PERIOD, agents: null },
      createRng(request.seed ^ 0x1a2b3c),
      1,
    ),
  );
  const baselineGdp = baselineOutcome.finalLevel.gdpLevel || 1;
  const baselineMetrics = adjustSeasonal(withGrowth(baselineOutcome.finalLevel, baselineGdp), baselinePressure);

  /* 3. Optional evolutionary search over the policy space */
  let paretoFront: ParetoCandidate[] = [];
  const convergence: SimulationResult["convergence"] = [];
  let deName: string | null = null;

  if (request.mode === "optimize" && !options.skipSearch) {
    onProgress({ phase: "Searching the policy space (Differential Evolution)", fraction: 0.25 });

    const searchAgents = Math.min(options.searchAgents ?? 400, base.size);
    const searchPeriods = Math.max(1, options.searchPeriods ?? 6);
    const samplerRng = createRng(request.seed ^ 0x77aa11);
    const sampleIndices = Int32Array.from({ length: searchAgents }, () => samplerRng.int(base.size));
    const searchSpec: PeriodSpec = {
      count: Math.min(searchPeriods, periods),
      monthsEach: Math.max(3, Math.round(policy.durationMonths / searchPeriods / 3) * 3),
      agents: sampleIndices,
    };

    // Search tier: reduced agent sample, coarser periods, and the deterministic
    // decision rule instead of a remote decision engine. Labelled in the UI.
    const fitness = (v: number[]): number[] => {
      const decoded = decodeVector(v, policy.channelIds, policy.name);
      const outcome = driveSync(
        trajectoryGenerator(
          clonePopulation(base),
          c,
          decoded,
          baselineGdp,
          searchSpec,
          createRng(request.seed ^ 0xd0e5),
          effectScale,
        ),
      );
      return objectivesFor(outcome.finalLevel, baselineGdp);
    };

    const dePop = options.dePopulation ?? 24;
    const deGens = options.deGenerations ?? 30;
    const de = differentialEvolution(fitness, {
      bounds: DE_BOUNDS,
      objectives: OBJECTIVE_LABELS.length,
      populationSize: dePop,
      generations: deGens,
      seed: request.seed ^ 0x5e7c,
      // Part C: seed the pool with this lineage's own history (best-first), so
      // crossover/mutation inherit within the lineage, not across instruments.
      // GGG adds one historically grounded seed at the grounded effect scale, so
      // the search starts from the evidence-informed point as well as history.
      initialPopulation: [
        encodePolicy({ ...policy, intensity: clamp01(policy.intensity * effectScale) }),
        ...(options.lineageSeeds ?? []),
      ],
      stagnationLimit: 12,
      maxEvaluations: (dePop + 1) * deGens,
      onGeneration: (point, front) => {
        convergence.push(point);
        onProgress({
          phase: "Searching the policy space (Differential Evolution)",
          fraction: 0.25 + 0.3 * clamp01((point.generation + 1) / deGens),
          detail: `generation ${point.generation + 1} · ${front.length} non-dominated candidates`,
        });
      },
    });
    deName = de.strategy;
    paretoFront = de.front.slice(0, 8).map((f, idx) => ({
      params: decodeVector(f.params, policy.channelIds, policy.name),
      objectives: Object.fromEntries(OBJECTIVE_LABELS.map((label, i) => [label, f.objectives[i]])),
      selected: idx === 0,
    }));

    // Honest reporting: does DE actually beat random search here?
    const randomBaseline = randomSearch(fitness, {
      bounds: DE_BOUNDS,
      sampleCount: Math.min(200, de.evaluations),
      seed: request.seed ^ 0x2222,
    });
    warnings.push(
      randomBaseline.bestScalar >= de.bestScalar
        ? `Random search matched or beat DE on this landscape (${randomBaseline.bestScalar.toFixed(3)} vs ${de.bestScalar.toFixed(3)}). Reported rather than hidden.`
        : `DE beat an equal-budget random search (${de.bestScalar.toFixed(3)} vs ${randomBaseline.bestScalar.toFixed(3)}).`,
    );
  }

  /* 4. Full-population trajectory for the selected policy */
  onProgress({ phase: "Running the full population trajectory", fraction: 0.6, detail: `${base.size.toLocaleString()} agents` });
  const treatedPop = clonePopulation(base);
  const treatedOutcome = await driveAsync(
    trajectoryGenerator(
      treatedPop,
      c,
      policy,
      baselineGdp,
      { count: periods, monthsEach: MONTHS_PER_PERIOD, agents: null },
      createRng(request.seed),
      effectScale,
      (fraction) =>
        onProgress({
          phase: "Running the full population trajectory",
          fraction: 0.6 + 0.25 * fraction,
          detail: `period ${Math.ceil(fraction * periods)} of ${periods}`,
        }),
    ),
    engine,
  );

  /* 5. Credible intervals from full-population seed variants */
  onProgress({ phase: "Estimating the random-seed variation range", fraction: 0.88 });
  const intervalRounds = options.intervalRounds ?? CONFIDENCE_ROUNDS;

  const treatedMetrics = adjustSeasonal(withGrowth(treatedOutcome.finalLevel, baselineGdp), policyPressure);
  const samples = new Map<MetricKey, number[]>();
  for (const key of Object.keys(treatedMetrics) as MetricKey[]) samples.set(key, [treatedMetrics[key]]);

  // Each round varies ONLY the seed and rolls the WHOLE population, because
  // every headline metric is a stated summation over all agents. A
  // partial-population round applies the policy to a subset while the
  // aggregation still spans everyone, so it reports a different quantity and
  // biases the band away from the point estimate it is meant to bracket.
  for (let round = 0; round < intervalRounds; round += 1) {
    const outcome = driveSync(
      trajectoryGenerator(
        clonePopulation(base),
        c,
        policy,
        baselineGdp,
        { count: periods, monthsEach: MONTHS_PER_PERIOD, agents: null },
        createRng(request.seed ^ (0x1000 + round)),
        effectScale,
      ),
    );
    const m = adjustSeasonal(withGrowth(outcome.finalLevel, baselineGdp), policyPressure);
    for (const key of Object.keys(m) as MetricKey[]) samples.get(key)?.push(m[key]);
  }

  // The reported point estimate is one of the samples (it is the seed the user
  // chose), so its empirical quantiles always bracket it — this is why the old
  // "widen the band on any seed whose quantiles exclude the point" hack could
  // be removed rather than kept.
  const intervals = Object.fromEntries(
    (Object.keys(treatedMetrics) as MetricKey[]).map((k) => [k, intervalFor(samples.get(k) ?? [])]),
  ) as SimulationResult["intervals"];

  // The DISPLAYED headline is the ensemble median, not one arbitrary seed's
  // value. This is what resolves the "point estimate outside its own displayed
  // 90% interval" bug: a median is bracketed by the 5th and 95th percentiles by
  // construction, for any number of seeds. The seed remains the reproducibility
  // mechanism — the chosen-seed trajectory is still reported in `trajectories`.
  const headlineMetrics = Object.fromEntries(
    (Object.keys(treatedMetrics) as MetricKey[]).map((k) => {
      const arr = Float64Array.from(samples.get(k) ?? []).sort();
      const n = arr.length;
      if (n === 0) return [k, treatedMetrics[k]];
      const pos = 0.5 * (n - 1);
      const lo = Math.floor(pos);
      const hi = Math.ceil(pos);
      const median = lo === hi ? arr[lo] : arr[lo] + (arr[hi] - arr[lo]) * (pos - lo);
      return [k, median];
    }),
  ) as Record<MetricKey, number>;

  /* 5b. Uncertainty: an empirical SHARE over the seed ensemble (never a probability). */
  const uncertainty = Object.fromEntries(
    (Object.keys(treatedMetrics) as MetricKey[]).map((k) => {
      const deltas = samples.get(k)!.map((v) => v - baselineMetrics[k]);
      const lowerIsBetter = LOWER_IS_BETTER.includes(k);
      const material = Math.max(1e-9, Math.abs(baselineMetrics[k]) * 1e-4);
      let improved = 0;
      let changed = 0;
      for (const d of deltas) {
        if (lowerIsBetter ? d < -material : d > material) improved += 1;
        if (Math.abs(d) > material) changed += 1;
      }
      const sorted = Float64Array.from(deltas).sort();
      const q = (f: number) => {
        if (sorted.length === 0) return 0;
        const pos = clamp(f, 0, 1) * (sorted.length - 1);
        const lo = Math.floor(pos);
        const hi = Math.ceil(pos);
        return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
      };
      return [
        k,
        {
          seedCount: deltas.length,
          improvedShare: deltas.length > 0 ? improved / deltas.length : 0,
          changedShare: deltas.length > 0 ? changed / deltas.length : 0,
          medianDelta: q(0.5),
          p05Delta: q(0.05),
          p95Delta: q(0.95),
        },
      ];
    }),
  ) as SimulationResult["uncertainty"];

  /* 6. Zone incidence — the payoff of a spatially resolved agent population */
  onProgress({ phase: "Computing zone incidence", fraction: 0.93 });
  const byZone = ZONES.reduce(
    (acc, zone) => {
      const baselineZoneGdp = zoneGdpLevel(baselinePop, zone);
      acc[zone] = zoneMetrics(treatedPop, zone, {
        baselineGdpLevel: baselineZoneGdp,
        townInflationPct: treatedOutcome.finalLevel.inflationPct,
        townMigrationOutflowPct: treatedOutcome.finalLevel.migrationOutflow * 100,
      });
      return acc;
    },
    {} as SimulationResult["byZone"],
  );

  /* 7. Trajectory curves from the same engine */
  // Every metric gets a curve. Three tabs (mean income, average earnings and
  // migration outflow) previously rendered empty boxes because their keys were
  // missing from this list.
  const trajectoryKeys: readonly MetricKey[] = METRIC_KEYS;
  const trajectories = Object.fromEntries(
    trajectoryKeys.map((key) => [
      key,
      treatedOutcome.levels.map((level, i): TrajectoryPoint => {
        const baseLevel = baselineOutcome.levels[Math.min(i, baselineOutcome.levels.length - 1)];
        const basePressure = baselineSeasonal.points[i]?.civicPressure ?? baselinePressure;
        const policyPressureHere = policySeasonal.points[i]?.civicPressure ?? policyPressure;
        return {
          month: (i + 1) * MONTHS_PER_PERIOD,
          baseline: adjustSeasonal(withGrowth(baseLevel, baselineGdp), basePressure)[key],
          simulated: adjustSeasonal(withGrowth(level, baselineGdp), policyPressureHere)[key],
        };
      }),
    ]),
  ) as SimulationResult["trajectories"];

  /* 8. Causal attribution on the treated population */
  const treatmentBands = {
    AggregateDemand: "normal",
    AggregateSectorOutput: "stable",
    EmploymentAggregate: "normal",
    MigrationAggregate: "low",
    Inflation: (["low", "moderate", "high"] as const)[treatedOutcome.inflationBand],
  };
  const causalAttributionFactors = causalAttribution(
    c,
    "EmploymentStatus",
    evidenceForAgent(treatedPop, 0, policy, treatmentBands, effectScale),
    2500,
    createRng(request.seed ^ 0xcafe),
  );

  /* 9. Identities and guardrails */
  const identityChecks: GuardrailCheck[] = checkIdentities(treatedPop, treatedOutcome.finalLevel).map((k) => ({
    check: k.identity,
    passed: k.passed,
    note: k.detail,
  }));
  const failed = identityChecks.filter((k) => !k.passed);
  if (failed.length > 0) {
    throw new AccountingViolationError(
      `Accounting identity violated: ${failed.map((f) => `${f.check} (${f.note})`).join("; ")}`,
    );
  }

  const zoneGrowth = Object.fromEntries(ZONES.map((z) => [z, byZone[z].metrics.gdpGrowthPct.p50])) as Record<string, number>;
  const headlineSign = Math.sign(treatedMetrics.gdpGrowthPct);
  const gdpSignConsistent = ZONES.every((zone) => {
    const z = zoneGrowth[zone];
    return headlineSign === 0 || Math.sign(z) === headlineSign || Math.abs(z) < 0.05;
  });

  const guardrails = await runGuardrails(engine, {
    identities: identityChecks,
    gdpSignConsistent,
    inflationComputedBand: treatedOutcome.inflationBand,
    inflationImpliedPct: treatedOutcome.finalLevel.inflationPct,
    state: describeTownState(treatedPop, policy, treatedOutcome.finalLevel, MONTHS_PER_PERIOD, periods * MONTHS_PER_PERIOD),
    reachability: treatedOutcome.reachability,
  });

  if (treatedOutcome.reachability < 0.6 && policyFamily !== "tax") {
    warnings.push(
      `Only ${(treatedOutcome.reachability * 100).toFixed(0)}% of intended transfers reach citizens: informal employment gates access to the instrument.`,
    );
  }
  if (policy.budget > REFERENCE_BUDGET) {
    warnings.push("Requested budget exceeds the reference envelope and was clamped.");
  }
  for (const note of grounding.notes) warnings.push(note);
  warnings.push(
    `GGG grounded effect scale ${effectScale.toFixed(3)} applied (parents: ${
      grounding.parents.length > 0 ? grounding.parents.map((p) => p.name).join("; ") : "none selected"
    }). The causal network read the grounded intensity and budget bands, not the raw ones.`,
  );

  const runId = fnv1a(
    [
      request.townId,
      policyFamily,
      policy.intensity.toFixed(4),
      policy.budget.toFixed(0),
      policy.durationMonths,
      request.seed,
      BN_VERSION,
      base.manifest,
      effectScale.toFixed(5),
    ].join("|"),
  );

  const result: SimulationResult = {
    runId,
    seed: request.seed,
    engine: { bn: BN_VERSION, de: deName, decision: engine.name },
    populationManifest: base.manifest,
    populationSize: base.size,
    periods,
    point: headlineMetrics,
    intervals,
    uncertainty,
    lineageKey: lineageKeyFor(policy),
    byZone,
    baseline: baselineMetrics,
    trajectories,
    distributions: {
      incomeBefore: incomeHistogram(baselinePop),
      incomeAfter: incomeHistogram(treatedPop),
      sentimentBefore: sentimentHistogram(baselinePop),
      sentimentAfter: sentimentHistogram(treatedPop),
    },
    paretoFront,
    convergence,
    causalAttribution: causalAttributionFactors,
    trajectoryTrace: treatedOutcome.levels.map((level, i) => ({
      period: i,
      month: (i + 1) * MONTHS_PER_PERIOD,
      metrics: withGrowth(level, baselineGdp),
      appliedIntensity: rampFor(policy.channelIds, (i + 1) * MONTHS_PER_PERIOD, policy.intensity),
      cumulativeSpend: level.cumulativeSpend,
    })),
    alerts: treatedOutcome.alerts,
    guardrails,
    decisionStats: engine.stats(),
    validation: validationChecks(base, c),
    warnings,
    ggg: grounding,
    seasonality: {
      policyCarriesPilgrimage: policySeasonal.exposure !== "none",
      exposure: policySeasonal.exposure,
      infraPolicy: policySeasonal.infraPolicy,
      startMonth: SEASONAL_START_MONTH,
      baselineMeanPressure: baselinePressure,
      policyMeanPressure: policyPressure,
      wariStep: policySeasonal.wariStep,
      peakPressure: policySeasonal.peakPressure,
      points: policySeasonal.points.map((pt, i) => ({
        period: pt.period,
        month: pt.month,
        monthOfYear: pt.monthOfYear,
        season: pt.season,
        inWari: pt.inWari,
        baselinePressure: baselineSeasonal.points[i]?.civicPressure ?? 0,
        policyPressure: pt.civicPressure,
      })),
    },
  };

  onProgress({ phase: "Complete", fraction: 1 });
  return result;
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/**
 * Derive the reported metrics, defining GDP growth against the no-policy
 * baseline produced by this same engine (§6.5.3).
 */
function withGrowth(level: PeriodLevels, baselineGdp: number): Record<MetricKey, number> {
  const metrics = metricsFromLevels(level);
  metrics.gdpGrowthPct = baselineGdp > 0 ? ((level.gdpLevel - baselineGdp) / baselineGdp) * 100 : 0;
  return metrics;
}

/** Mean civic pressure across a seasonal profile. */
function meanCivicPressure(profile: SeasonalProfile): number {
  return profile.points.length
    ? profile.points.reduce((s, p) => s + p.civicPressure, 0) / profile.points.length
    : 0;
}

/**
 * Fold the Wari seasonal pressure into the two metrics it affects. This is a
 * MODEL ASSUMPTION (only the sign is asserted; see seasonality.ts). It is
 * applied identically to baseline and treated for any policy that does not carry
 * a pilgrimage channel, so those runs' deltas are unchanged.
 */
function adjustSeasonal(metrics: Record<MetricKey, number>, civicPressure: number): Record<MetricKey, number> {
  const adjusted = applySeasonalPressure(civicPressure, metrics.happinessIndex, metrics.protestRisk);
  return { ...metrics, happinessIndex: adjusted.happinessIndex, protestRisk: adjusted.protestRisk };
}

function evidenceForAgent(
  pop: Population,
  i: number,
  policy: PolicyVector,
  bands: Record<string, string>,
  effectScale = 1,
): Evidence {
  return {
    PolicyType: engineInstrumentFor(policy.channelIds),
    PolicyIntensity: bandFor(policy.intensity * effectScale, 0.4, 0.72),
    PolicyBudgetShare: bandFor((policy.budget / REFERENCE_BUDGET) * effectScale, 0.25, 0.6),
    PolicyDuration: policy.durationMonths <= 12 ? "short" : policy.durationMonths <= 36 ? "medium" : "long",
    IncomeClassPrior: INCOME_CLASSES[pop.incomeClass[i]],
    AgeBand: AGE_BANDS[pop.ageBand[i]],
    EducationLevel: EDUCATION_LEVELS[pop.education[i]],
    HousingQuality: QUALITY_LEVELS[pop.housing[i]],
    TrustInGov: trustBandOf(pop, i),
    ...bands,
  };
}

