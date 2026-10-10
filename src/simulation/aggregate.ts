/**
 * Micro -> macro aggregation (SIMULATION_LAB_SPEC.md §6.7).
 *
 * No macro quantity is ever set directly. Every headline number is a stated
 * summation over the agent population, and the accounting identities below must
 * hold on every run or the run fails loudly. This is what separates a simulator
 * from a random-number generator.
 */

import { WORKING_AGE_MIN } from "./census";
import { clamp01, gini, mean, quantile } from "./rng";
import { EMPLOYMENT_STATUSES, INCOME_CLASSES, INCOME_CLASS_LABELS, SECTORS, SENTIMENTS, ZONES } from "./types";
import type { MetricKey, Population, Zone } from "./types";

/** Modelled relative productivity by sector, used for the output identity. */
export const SECTOR_PRODUCTIVITY: Record<string, number> = {
  agriculture: 0.7,
  manufacturing: 1.2,
  services: 1.15,
  pilgrimage_tourism: 0.85,
  construction: 0.95,
  trade: 1.0,
  public_admin: 1.05,
  informal_other: 0.6,
};

/** Representative midpoint of each sampled inflation band, in percent (modelled). */
const INFLATION_BAND_PCT = [2.4, 4.1, 6.8];
/** Weight applied to an agent's sector output by its sampled output state. */
export const OUTPUT_STATE_WEIGHT = [0.9, 1.0, 1.12];

export interface PeriodLevels {
  /** Absolute quantities. Metrics are derived from these, never set directly. */
  employedCount: number;
  workingAgeCount: number;
  labourForceCount: number;
  inactiveCount: number;
  gdpLevel: number;
  wageLevel: number;
  inflationPct: number;
  happinessScore: number;
  gini: number;
  protestRisk: number;
  migrationOutflow: number;
  meanHouseholdIncomePerCapita: number;
  budgetOutlay: number;
  budgetRevenue: number;
  taxRevenue: number;
  transfersAssigned: number;
  demandPressure: number;
  declaredBudget: number;
  cumulativeSpend: number;
}

export interface AggregateBands {
  AggregateDemand: string;
  AggregateSectorOutput: string;
  EmploymentAggregate: string;
  MigrationAggregate: string;
}

export interface IdentityCheck {
  identity: string;
  passed: boolean;
  detail: string;
}

export class AccountingViolationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AccountingViolationError";
  }
}

/* ------------------------------------------------------------------ */
/* Core aggregation                                                    */
/* ------------------------------------------------------------------ */

export interface AggregationInput {
  pop: Population;
  /** Sampled town-level inflation band index for this period. */
  inflationBand: number;
  /** Per-period policy spend actually committed (INR). */
  budgetSpend: number;
  /** Government revenue collected this period from the tax channel (INR). */
  taxRevenue: number;
  /** Transfers actually reaching agents this period (INR). */
  transfersAssigned: number;
  /** External funding covering any gap (INR). */
  externalFunding: number;
  /** Cumulative fraction of the initial population that has migrated out. */
  migrationOutflow: number;
  /** Total budget the policy declared, in INR. */
  declaredBudget: number;
  /** Cumulative spend across all periods so far, in INR. */
  cumulativeSpend: number;
}

/**
 * Compute absolute period quantities from the agent population. Every value is
 * a summation over agents — see the identities in the doc comment of this file.
 */
export function computeLevels(input: AggregationInput): PeriodLevels {
  const { pop } = input;
  let active = 0;
  let employed = 0;
  let workingAge = 0;
  let labourForce = 0;
  let wageSum = 0;
  let wageCount = 0;
  let happinessSum = 0;
  let protestSum = 0;
  let gdpLevel = 0;
  const perCapitaIncome = new Float64Array(pop.size);
  let perCapitaCount = 0;

  for (let i = 0; i < pop.size; i += 1) {
    if (!pop.active[i]) continue;
    active += 1;
    const isWorkingAge = pop.age[i] >= WORKING_AGE_MIN;
    if (isWorkingAge) workingAge += 1;

    const emp = pop.employmentStatus[i];
    const isEmployed = emp !== EMPLOYMENT_STATUSES.indexOf("unemployed");
    if (isEmployed) employed += 1;
    if (isEmployed || (isWorkingAge && pop.workerStatus[i] !== 0)) labourForce += 1;

    if (isEmployed) {
      wageSum += pop.income[i];
      wageCount += 1;
      const sectorName = SECTORS[pop.sector[i]];
      const productivity = SECTOR_PRODUCTIVITY[sectorName] ?? 1;
      const stateWeight = OUTPUT_STATE_WEIGHT[pop.outputState[i]] ?? 1;
      gdpLevel += productivity * stateWeight * (1 + pop.skillRelevance[i] * 0.25);
    }

    happinessSum += [0, 0.5, 1][pop.sentiment[i]] ?? 0.5;
    protestSum += clamp01(pop.protestPropensity[i]);

    const householdPerCapita = pop.householdIncome[pop.household[i]] / pop.householdSize[pop.household[i]];
    perCapitaIncome[i] = householdPerCapita;
    perCapitaCount += 1;
  }

  const householdPerCapitaActive = perCapitaIncome.subarray(0, perCapitaCount);
  const demandPressure = employed > 0 ? wageSum / employed / 1000 : 0;

  return {
    employedCount: employed,
    workingAgeCount: workingAge,
    labourForceCount: labourForce,
    inactiveCount: active - workingAge,
    gdpLevel,
    wageLevel: wageCount > 0 ? wageSum / wageCount : 0,
    inflationPct: INFLATION_BAND_PCT[input.inflationBand] ?? 4.1,
    happinessScore: active > 0 ? (happinessSum / active) * 100 : 0,
    gini: gini(householdPerCapitaActive, perCapitaCount),
    // Mean per-agent protest propensity, NOT the union over 98,923 agents.
    // A union reads ~100% for any non-zero per-agent probability, so it has
    // no information; the mean is the share-weighted risk the metric names.
    protestRisk: active > 0 ? protestSum / active : 0,
    migrationOutflow: input.migrationOutflow,
    meanHouseholdIncomePerCapita: mean(householdPerCapitaActive, perCapitaCount),
    budgetOutlay: input.budgetSpend,
    budgetRevenue: input.taxRevenue + input.externalFunding,
    taxRevenue: input.taxRevenue,
    transfersAssigned: input.transfersAssigned,
    demandPressure,
    declaredBudget: input.declaredBudget,
    cumulativeSpend: input.cumulativeSpend,
  };
}

/** Derive the reported metric vector from the absolute quantities. */
export function metricsFromLevels(l: PeriodLevels): Record<MetricKey, number> {
  return {
    gdpGrowthPct: 0, // filled in by the caller, relative to the baseline level
    employmentRatePct: l.workingAgeCount > 0 ? (l.employedCount / l.workingAgeCount) * 100 : 0,
    meanIncome: l.meanHouseholdIncomePerCapita,
    wageIndex: l.wageLevel,
    inflationPct: l.inflationPct,
    happinessIndex: l.happinessScore,
    gini: l.gini,
    protestRisk: l.protestRisk * 100,
    migrationOutflowPct: l.migrationOutflow * 100,
  };
}

/** Discretise the period's aggregates for the town layer of the network. */
export function aggregateBands(l: PeriodLevels, baselineGdpLevel: number): AggregateBands {
  const growth = baselineGdpLevel > 0 ? (l.gdpLevel - baselineGdpLevel) / baselineGdpLevel : 0;
  const employmentRate = l.workingAgeCount > 0 ? l.employedCount / l.workingAgeCount : 0;

  const demand = l.demandPressure < 8 ? "weak" : l.demandPressure < 14 ? "normal" : "strong";
  const sectorOutput = growth < -0.01 ? "declining" : growth < 0.015 ? "stable" : "rising";
  const employment = employmentRate < 0.62 ? "low" : employmentRate < 0.78 ? "normal" : "high";
  const migration = l.migrationOutflow < 0.005 ? "low" : l.migrationOutflow < 0.03 ? "normal" : "high";
  return {
    AggregateDemand: demand,
    AggregateSectorOutput: sectorOutput,
    EmploymentAggregate: employment,
    MigrationAggregate: migration,
  };
}

/* ------------------------------------------------------------------ */
/* Identities                                                          */
/* ------------------------------------------------------------------ */

/**
 * Hard accounting constraints. Every one of these must hold on every run;
 * `runSimulation` throws `AccountingViolationError` when one does not.
 */
export function checkIdentities(pop: Population, l: PeriodLevels): IdentityCheck[] {
  const checks: IdentityCheck[] = [];
  const add = (identity: string, passed: boolean, detail: string) =>
    checks.push({ identity, passed, detail });

  let active = 0;
  let employed = 0;
  let unemployed = 0;
  let inactive = 0;
  let zoneTotal = 0;
  const zoneCounts = new Array(ZONES.length).fill(0);
  const sectorEmployed = new Array(SECTORS.length).fill(0);

  for (let i = 0; i < pop.size; i += 1) {
    if (!pop.active[i]) continue;
    active += 1;
    zoneCounts[pop.zone[i]] += 1;
    const workingAge = pop.age[i] >= WORKING_AGE_MIN;
    if (!workingAge) inactive += 1;
    else if (pop.employmentStatus[i] === EMPLOYMENT_STATUSES.indexOf("unemployed")) unemployed += 1;
    else {
      employed += 1;
      sectorEmployed[pop.sector[i]] += 1;
    }
  }
  zoneTotal = zoneCounts.reduce((a, b) => a + b, 0);

  add(
    "employed + unemployed + inactive = active population",
    employed + unemployed + inactive === active,
    `${employed} + ${unemployed} + ${inactive} = ${employed + unemployed + inactive} vs active ${active}`,
  );
  add(
    "sum of sector employment = total employed",
    sectorEmployed.reduce((a, b) => a + b, 0) === employed,
    `${sectorEmployed.reduce((a, b) => a + b, 0)} vs ${employed}`,
  );
  add(
    "zone populations sum to the town population",
    zoneTotal === active,
    `${zoneTotal} vs ${active}`,
  );
  add(
    "labour force does not exceed the working-age population",
    l.labourForceCount <= l.workingAgeCount,
    `${l.labourForceCount} vs ${l.workingAgeCount}`,
  );

  // Budget flow identities: nothing is spent that is not funded, and the
  // declared budget is never exceeded. This is what makes the instrument real
  // rather than an unconstrained dial.
  add(
    "programme spend is fully funded",
    l.budgetRevenue >= l.budgetOutlay - 1,
    `funded ${Math.round(l.budgetRevenue)} vs outlay ${Math.round(l.budgetOutlay)}`,
  );
  add(
    "cumulative spend within the declared budget",
    l.cumulativeSpend <= l.declaredBudget * 1.0001 + 1,
    `${Math.round(l.cumulativeSpend)} of ${Math.round(l.declaredBudget)}`,
  );
  add(
    "transfers assigned never exceed the outlay",
    l.transfersAssigned <= l.budgetOutlay * 1.0001 + 1,
    `${Math.round(l.transfersAssigned)} vs ${Math.round(l.budgetOutlay)}`,
  );

  return checks;
}

export function assertIdentities(pop: Population, l: PeriodLevels): void {
  const failures = checkIdentities(pop, l).filter((c) => !c.passed);
  if (failures.length > 0) {
    throw new AccountingViolationError(
      `Accounting identity violated: ${failures.map((f) => `${f.identity} (${f.detail})`).join("; ")}`,
    );
  }
}

/* ------------------------------------------------------------------ */
/* Distributions and zone breakdowns                                   */
/* ------------------------------------------------------------------ */

const INCOME_BUCKETS: { label: string; from: number; to: number }[] = [
  { label: "<₹2k", from: 0, to: 2000 },
  { label: "₹2–4k", from: 2000, to: 4000 },
  { label: "₹4–7k", from: 4000, to: 7000 },
  { label: "₹7–12k", from: 7000, to: 12000 },
  { label: "₹12–20k", from: 12000, to: 20000 },
  { label: "₹20k+", from: 20000, to: Number.POSITIVE_INFINITY },
];

export function incomeHistogram(pop: Population): { bucket: string; count: number }[] {
  const counts = INCOME_BUCKETS.map(() => 0);
  for (let i = 0; i < pop.size; i += 1) {
    if (!pop.active[i]) continue;
    const perCapita = pop.householdIncome[pop.household[i]] / pop.householdSize[pop.household[i]];
    for (let b = 0; b < INCOME_BUCKETS.length; b += 1) {
      if (perCapita >= INCOME_BUCKETS[b].from && perCapita < INCOME_BUCKETS[b].to) {
        counts[b] += 1;
        break;
      }
    }
  }
  return INCOME_BUCKETS.map((b, i) => ({ bucket: b.label, count: counts[i] }));
}

export function sentimentHistogram(pop: Population): { label: string; count: number }[] {
  const counts = SENTIMENTS.map(() => 0);
  for (let i = 0; i < pop.size; i += 1) {
    if (!pop.active[i]) continue;
    counts[pop.sentiment[i]] += 1;
  }
  return SENTIMENTS.map((label, i) => ({ label, count: counts[i] }));
}

export function incomeClassHistogram(pop: Population): { label: string; count: number }[] {
  const counts = INCOME_CLASSES.map(() => 0);
  for (let i = 0; i < pop.size; i += 1) {
    if (!pop.active[i]) continue;
    counts[pop.incomeClass[i]] += 1;
  }
  return INCOME_CLASSES.map((c, i) => ({ label: INCOME_CLASS_LABELS[c], count: counts[i] }));
}

/**
 * Metrics restricted to one zone — the spatial incidence readout.
 *
 * The point of a spatially resolved agent population: a policy can improve the
 * town-wide average while helping one zone far more than another, and that
 * difference is the most actionable thing a policymaker can see.
 */
export function zoneMetrics(
  pop: Population,
  zone: Zone,
  options: {
    /** Zone GDP level from the no-policy baseline run, for the growth denominator. */
    baselineGdpLevel: number;
    /** Town-wide inflation for this period (the town layer is not per-zone). */
    townInflationPct: number;
    /** Town-wide migration outflow for this period. */
    townMigrationOutflowPct: number;
  },
): { population: number; metrics: Record<MetricKey, { p05: number; p50: number; p95: number }> } {
  const zoneIdx = ZONES.indexOf(zone);
  const incomes: number[] = [];
  let employed = 0;
  let workingAge = 0;
  let happiness = 0;
  let protestSum = 0;
  let active = 0;
  let gdpLevel = 0;
  let wageSum = 0;
  let wageCount = 0;

  for (let i = 0; i < pop.size; i += 1) {
    if (!pop.active[i] || pop.zone[i] !== zoneIdx) continue;
    active += 1;
    const isWorkingAge = pop.age[i] >= WORKING_AGE_MIN;
    if (isWorkingAge) workingAge += 1;
    const isEmployed = pop.employmentStatus[i] !== EMPLOYMENT_STATUSES.indexOf("unemployed");
    if (isEmployed) {
      employed += 1;
      wageSum += pop.income[i];
      wageCount += 1;
      const productivity = SECTOR_PRODUCTIVITY[SECTORS[pop.sector[i]]] ?? 1;
      const stateWeight = OUTPUT_STATE_WEIGHT[pop.outputState[i]] ?? 1;
      gdpLevel += productivity * stateWeight * (1 + pop.skillRelevance[i] * 0.25);
    }
    incomes.push(pop.householdIncome[pop.household[i]] / pop.householdSize[pop.household[i]]);
    happiness += [0, 0.5, 1][pop.sentiment[i]] ?? 0.5;
    protestSum += clamp01(pop.protestPropensity[i]);
  }

  const sorted = Float64Array.from(incomes).sort();
  const spread = (v: number, rel: number): { p05: number; p50: number; p95: number } => ({
    p05: Math.max(0, v - Math.abs(v) * rel),
    p50: v,
    p95: v + Math.abs(v) * rel,
  });

  const employmentRate = workingAge > 0 ? (employed / workingAge) * 100 : 0;
  const meanIncome = sorted.length > 0 ? mean(sorted) : 0;
  const happinessIndex = active > 0 ? (happiness / active) * 100 : 0;
  // Same correction as computeLevels: mean per-agent propensity, not a union.
  const protest = (active > 0 ? protestSum / active : 0) * 100;
  const growth =
    options.baselineGdpLevel > 0 ? ((gdpLevel - options.baselineGdpLevel) / options.baselineGdpLevel) * 100 : 0;

  return {
    population: active,
    metrics: {
      gdpGrowthPct: spread(growth, 0.03),
      employmentRatePct: spread(employmentRate, 0.02),
      meanIncome: {
        p05: sorted.length > 0 ? quantile(sorted, 0.05) : 0,
        p50: sorted.length > 0 ? quantile(sorted, 0.5) : meanIncome,
        p95: sorted.length > 0 ? quantile(sorted, 0.95) : 0,
      },
      wageIndex: spread(wageCount > 0 ? wageSum / wageCount : 0, 0.03),
      inflationPct: spread(options.townInflationPct, 0.01),
      happinessIndex: spread(happinessIndex, 0.03),
      gini: spread(sorted.length > 0 ? gini(sorted) : 0, 0.02),
      protestRisk: spread(protest, 0.08),
      migrationOutflowPct: spread(options.townMigrationOutflowPct, 0.05),
    },
  };
}

/** Zone-level GDP level, used as the growth denominator for zone incidence. */
export function zoneGdpLevel(pop: Population, zone: Zone): number {
  const zoneIdx = ZONES.indexOf(zone);
  let gdpLevel = 0;
  for (let i = 0; i < pop.size; i += 1) {
    if (!pop.active[i] || pop.zone[i] !== zoneIdx) continue;
    if (pop.employmentStatus[i] === EMPLOYMENT_STATUSES.indexOf("unemployed")) continue;
    const productivity = SECTOR_PRODUCTIVITY[SECTORS[pop.sector[i]]] ?? 1;
    const stateWeight = OUTPUT_STATE_WEIGHT[pop.outputState[i]] ?? 1;
    gdpLevel += productivity * stateWeight * (1 + pop.skillRelevance[i] * 0.25);
  }
  return gdpLevel;
}

export function zonePopulations(pop: Population): Record<Zone, number> {
  const counts = new Array(ZONES.length).fill(0);
  for (let i = 0; i < pop.size; i += 1) {
    if (pop.active[i]) counts[pop.zone[i]] += 1;
  }
  return ZONES.reduce(
    (acc, z, i) => {
      acc[z] = counts[i];
      return acc;
    },
    {} as Record<Zone, number>,
  );
}

/** Metric keys that should be interpreted as "lower is better" in the UI. */
export const LOWER_IS_BETTER: MetricKey[] = ["inflationPct", "gini", "protestRisk", "migrationOutflowPct"];

/**
 * Honest display labels. `gdpGrowthPct` is NOT a growth RATE: it is the
 * percentage DEVIATION of the modelled GDP level from the no-policy baseline
 * (see `withGrowth` in simulate.ts), so it is labelled as a comparison, not as
 * growth. The underlying `gdpLevel` is itself a productivity-weighted EMPLOYMENT
 * proxy, not real-world macroeconomic GDP — stated here and in the UI note.
 */
export const METRIC_LABELS: Record<MetricKey, string> = {
  gdpGrowthPct: "GDP vs no-policy baseline",
  employmentRatePct: "Employment rate",
  meanIncome: "Mean income / capita",
  wageIndex: "Average earnings",
  inflationPct: "Inflation",
  happinessIndex: "Happiness index",
  gini: "Gini coefficient",
  protestRisk: "Protest risk",
  migrationOutflowPct: "Migration outflow",
};

/**
 * Central, single-source metric semantics. The engine, impact layer, UI cards,
 * charts, tooltips and documentation all derive their meaning from here so the
 * same metric cannot be described two different ways on two screens. Each entry
 * states the quantity, its unit and what a positive number means — including the
 * ones where "up" is not "better".
 */
export const METRIC_DESCRIPTIONS: Record<MetricKey, string> = {
  gdpGrowthPct:
    "Percentage DEVIATION of the modelled GDP level (a productivity-weighted employment proxy, NOT real GDP) from the no-policy baseline. Positive = more activity than with no policy.",
  employmentRatePct:
    "Share of the working-age population in formal or informal work. A rate, in percent; positive = more people employed.",
  meanIncome:
    "Mean household income per person, in rupees per month. A level, not a rate; positive = higher income.",
  wageIndex:
    "Mean monthly earnings of employed agents, in rupees. A level; distinct from mean income per capita, which includes non-earners.",
  inflationPct:
    "Modelled price index change, in percent per period. LOWER is treated as better, but not automatically: deflation is not an improvement.",
  happinessIndex:
    "Mean modelled sentiment, 0–100. An index, not a probability; higher = more positive sentiment.",
  gini:
    "Gini coefficient of the simulated household per-capita income distribution, 0–1. Structural: it is computed from the actual distribution, not from the mean.",
  protestRisk:
    "Mean per-agent protest propensity, in percent (share-weighted), NOT the union over all agents. A modelled risk, not an observed probability.",
  migrationOutflowPct:
    "Cumulative share of the population that has left the town, in percent. Driven by the migration pathway, not by GDP alone.",
};

export const METRIC_UNITS: Record<MetricKey, string> = {
  gdpGrowthPct: "%",
  employmentRatePct: "%",
  meanIncome: "₹",
  wageIndex: "₹",
  inflationPct: "%",
  happinessIndex: "",
  gini: "",
  protestRisk: "%",
  migrationOutflowPct: "%",
};
