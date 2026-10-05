/**
 * Differential Evolution and multi-objective Pareto selection (§11).
 *
 * DE/rand/1/bin with dithering, Latin-hypercube initialisation, and greedy
 * selection. For conflicting objectives (reduce unemployment AND contain
 * inflation) the search runs NSGA-II-style selection — non-dominated rank, then
 * crowding distance — and returns a Pareto front rather than silently picking
 * one winner. The policymaker chooses among explicit trade-offs.
 *
 * Everything is seeded, so the same seed reproduces the same front.
 */

import { clamp, createRng, type Rng } from "./rng";

export interface DeBounds {
  lower: number;
  upper: number;
}

export interface DeOptions {
  bounds: DeBounds[];
  /** Number of objectives the fitness function returns. */
  objectives: number;
  populationSize?: number;
  generations?: number;
  /** Mutation scale factor. */
  differentialWeight?: number;
  /** Crossover probability. */
  crossoverRate?: number;
  strategy?: "rand1bin" | "best1bin";
  seed: number;
  /**
   * A lineage's own history, encoded as vectors. When supplied, these seed the
   * initial population (in order, best-first) and the remainder is filled by
   * Latin-hypercube sampling. Because the mutation base and the two difference
   * vectors are drawn from the current population, inheritance stays inside the
   * lineage's pool rather than a shared cross-instrument gene pool.
   */
  initialPopulation?: number[][];
  /** Stop early after this many generations without improvement. */
  stagnationLimit?: number;
  maxEvaluations?: number;
  onGeneration?: (point: ConvergencePoint, front: number[][]) => void;
}

export interface ConvergencePoint {
  generation: number;
  best: number;
  mean: number;
  spread: number;
}

export interface DeResult {
  /** Scalarised best vector (used for the headline run). */
  best: number[];
  bestObjectives: number[];
  bestScalar: number;
  /** Every non-dominated candidate found in the final generation. */
  front: { params: number[]; objectives: number[] }[];
  convergence: ConvergencePoint[];
  evaluations: number;
  strategy: string;
  populationSize: number;
  generations: number;
}

export function dominates(a: number[], b: number[]): boolean {
  let strictlyBetter = false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] < b[i]) return false;
    if (a[i] > b[i]) strictlyBetter = true;
  }
  return strictlyBetter;
}

/** Fast non-dominated sort, returning the rank of each point (Deb et al., 2002). */
export function nonDominatedSort(objectives: number[][]): number[] {
  const n = objectives.length;
  const rank = new Array(n).fill(0);
  const dominatedBy: number[][] = Array.from({ length: n }, () => []);
  const dominationCount = new Array(n).fill(0);
  const fronts: number[][] = [[]];

  for (let p = 0; p < n; p += 1) {
    for (let q = 0; q < n; q += 1) {
      if (p === q) continue;
      if (dominates(objectives[p], objectives[q])) dominatedBy[p].push(q);
      else if (dominates(objectives[q], objectives[p])) dominationCount[p] += 1;
    }
    if (dominationCount[p] === 0) {
      rank[p] = 0;
      fronts[0].push(p);
    }
  }

  let i = 0;
  while (fronts[i] && fronts[i].length > 0) {
    const next: number[] = [];
    for (const p of fronts[i]) {
      for (const q of dominatedBy[p]) {
        dominationCount[q] -= 1;
        if (dominationCount[q] === 0) {
          rank[q] = i + 1;
          next.push(q);
        }
      }
    }
    i += 1;
    if (next.length > 0) fronts[i] = next;
  }

  return rank;
}

export function crowdingDistance(objectives: number[][], members: number[]): number[] {
  const distance = new Array(objectives.length).fill(0);
  if (members.length === 0) return distance;
  const m = objectives[members[0]].length;
  for (let obj = 0; obj < m; obj += 1) {
    const sorted = [...members].sort((a, b) => objectives[a][obj] - objectives[b][obj]);
    distance[sorted[0]] = Number.POSITIVE_INFINITY;
    distance[sorted[sorted.length - 1]] = Number.POSITIVE_INFINITY;
    const span = objectives[sorted[sorted.length - 1]][obj] - objectives[sorted[0]][obj];
    if (span <= 0) continue;
    for (let k = 1; k < sorted.length - 1; k += 1) {
      const prev = objectives[sorted[k - 1]][obj];
      const next = objectives[sorted[k + 1]][obj];
      distance[sorted[k]] += (next - prev) / span;
    }
  }
  return distance;
}

/** Membership of the non-dominated front over the given objective vectors. */
export function paretoFrontMembers(objectives: number[][]): number[] {
  const rank = nonDominatedSort(objectives);
  return rank.map((r, i) => (r === 0 ? i : -1)).filter((i) => i >= 0);
}

export function paretoFront(objectives: number[][]): number[][] {
  return paretoFrontMembers(objectives).map((i) => objectives[i]);
}

function latinHypercube(bounds: DeBounds[], n: number, rng: Rng): number[][] {
  const d = bounds.length;
  const samples: number[][] = [];
  for (let i = 0; i < d; i += 1) samples.push(new Array(n).fill(0));
  for (let i = 0; i < d; i += 1) {
    const perm = Array.from({ length: n }, (_, k) => k);
    rng.shuffle(perm);
    for (let k = 0; k < n; k += 1) {
      samples[i][k] = (perm[k] + rng.next()) / n;
    }
  }
  const out: number[][] = Array.from({ length: n }, () => new Array(d).fill(0));
  for (let k = 0; k < n; k += 1) {
    for (let i = 0; i < d; i += 1) {
      out[k][i] = bounds[i].lower + samples[i][k] * (bounds[i].upper - bounds[i].lower);
    }
  }
  return out;
}

function clipToBounds(v: number[], bounds: DeBounds[]): number[] {
  return v.map((x, i) => clamp(x, bounds[i].lower, bounds[i].upper));
}

/**
 * Run Differential Evolution.
 *
 * `fitness` receives a candidate vector and returns one value per objective,
 * all of them "higher is better". Fitness must be deterministic for a given
 * vector — the engine guarantees this by using a fixed evaluation seed.
 */
export function differentialEvolution(
  fitness: (params: number[]) => number[],
  options: DeOptions,
): DeResult {
  const {
    bounds,
    objectives,
    populationSize = 40,
    generations = 60,
    differentialWeight = 0.6,
    crossoverRate = 0.9,
    strategy = "rand1bin",
    seed,
    stagnationLimit = 20,
    maxEvaluations = 4000,
  } = options;

  const rng = createRng(seed);
  const d = bounds.length;
  const np = Math.max(8, populationSize);

  let population = latinHypercube(bounds, np, rng);
  if (options.initialPopulation && options.initialPopulation.length > 0) {
    const injected = options.initialPopulation
      .slice(0, np)
      .map((v) => clipToBounds(v, bounds));
    population = injected.concat(population.slice(injected.length));
  }
  let evaluated = 0;
  const objectiveCache = new Map<string, number[]>();

  const evaluate = (v: number[]): number[] => {
    const key = v.map((x) => x.toFixed(6)).join(",");
    const cached = objectiveCache.get(key);
    if (cached) return cached;
    const result = fitness(v);
    objectiveCache.set(key, result);
    evaluated += 1;
    return result;
  };

  let objValues = population.map(evaluate);
  const convergence: ConvergencePoint[] = [];
  let stagnant = 0;
  let bestScalar = -Infinity;
  let generation = 0;

  const scalarOf = (o: number[]): number => o.reduce((a, b) => a + b, 0) / o.length;

  for (generation = 0; generation < generations; generation += 1) {
    if (evaluated >= maxEvaluations) break;

    const nextPopulation: number[][] = [];
    const nextObjectives: number[][] = [];

    for (let i = 0; i < np; i += 1) {
      // Choose the base vector according to the strategy.
      let baseIdx: number;
      if (strategy === "best1bin") {
        let bestIdx = 0;
        for (let k = 1; k < np; k += 1) {
          if (scalarOf(objValues[k]) > scalarOf(objValues[bestIdx])) bestIdx = k;
        }
        baseIdx = bestIdx;
      } else {
        baseIdx = rng.int(np);
      }

      let r1 = rng.int(np);
      let r2 = rng.int(np);
      let guard = 0;
      while ((r1 === baseIdx || r1 === r2) && guard < 50) {
        r1 = rng.int(np);
        guard += 1;
      }
      guard = 0;
      while ((r2 === baseIdx || r2 === r1) && guard < 50) {
        r2 = rng.int(np);
        guard += 1;
      }

      // Dithered mutation scale keeps the population from collapsing.
      const f = differentialWeight * (0.5 + rng.next());
      const mutant = new Array(d);
      for (let k = 0; k < d; k += 1) {
        mutant[k] = population[baseIdx][k] + f * (population[r1][k] - population[r2][k]);
      }
      const clipped = clipToBounds(mutant, bounds);

      // Binomial crossover.
      const jRand = rng.int(d);
      const trial = population[i].slice();
      for (let k = 0; k < d; k += 1) {
        if (rng.next() < crossoverRate || k === jRand) trial[k] = clipped[k];
      }

      const trialObjectives = evaluate(trial);
      let accept: boolean;
      if (objectives > 1) {
        // NSGA-II-style greedy: prefer the less-dominated, then the less crowded.
        const rankOld = nonDominatedSort([objValues[i], trialObjectives])[0];
        const rankNew = nonDominatedSort([objValues[i], trialObjectives])[1];
        if (rankNew < rankOld) accept = true;
        else if (rankNew > rankOld) accept = false;
        else {
          const dist = crowdingDistance([objValues[i], trialObjectives], [0, 1]);
          accept = dist[1] >= dist[0];
        }
      } else {
        accept = trialObjectives[0] > objValues[i][0];
      }

      if (accept) {
        nextPopulation.push(trial);
        nextObjectives.push(trialObjectives);
      } else {
        nextPopulation.push(population[i]);
        nextObjectives.push(objValues[i]);
      }
    }

    population = nextPopulation;
    objValues = nextObjectives;

    const scalars = objValues.map(scalarOf);
    const genBest = Math.max(...scalars);
    const genMean = scalars.reduce((a, b) => a + b, 0) / scalars.length;
    const genSpread = Math.sqrt(scalars.reduce((a, b) => a + (b - genMean) ** 2, 0) / scalars.length);

    convergence.push({ generation, best: genBest, mean: genMean, spread: genSpread });

    if (genBest <= bestScalar + 1e-9) stagnant += 1;
    else {
      stagnant = 0;
      bestScalar = genBest;
    }

    options.onGeneration?.(convergence[convergence.length - 1], paretoFrontMembers(objValues).map((i) => population[i]));
    if (stagnant >= stagnationLimit) break;
  }

  // Normalise a single scalar objective for selection purposes.
  const normalised = objValues.map((o) => (objectives > 1 ? o.map((v) => v) : [o[0]]));
  const members = paretoFrontMembers(normalised);
  const scalarScores = objValues.map(scalarOf);
  let bestIdx = 0;
  for (let i = 1; i < np; i += 1) if (scalarScores[i] > scalarScores[bestIdx]) bestIdx = i;

  return {
    best: population[bestIdx],
    bestObjectives: objValues[bestIdx],
    bestScalar: scalarScores[bestIdx],
    front: members.map((i) => ({ params: population[i], objectives: objValues[i] })),
    convergence,
    evaluations: evaluated,
    strategy: `DE/${strategy}`,
    populationSize: np,
    generations: convergence.length,
  };
}

/**
 * Random search over the same budget. Reported alongside DE so the paper can
 * state whether the evolutionary search actually beat random sampling on this
 * fitness landscape — if it did not, that is a finding worth reporting.
 */
export function randomSearch(
  fitness: (params: number[]) => number[],
  options: { bounds: DeBounds[]; sampleCount: number; seed: number },
): { best: number[]; bestObjectives: number[]; bestScalar: number; evaluations: number } {
  const rng = createRng(options.seed ^ 0x2f6f2f);
  const scalarOf = (o: number[]) => o.reduce((a, b) => a + b, 0) / o.length;
  let best: number[] = [];
  let bestObjectives: number[] = [];
  let bestScalar = -Infinity;
  for (let k = 0; k < options.sampleCount; k += 1) {
    const candidate = options.bounds.map((b) => b.lower + rng.next() * (b.upper - b.lower));
    const objectives = fitness(candidate);
    const score = scalarOf(objectives);
    if (score > bestScalar) {
      bestScalar = score;
      best = candidate;
      bestObjectives = objectives;
    }
  }
  return { best, bestObjectives, bestScalar, evaluations: options.sampleCount };
}
