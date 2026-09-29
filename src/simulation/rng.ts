/**
 * Deterministic, reproducible random number generation.
 *
 * Every stochastic step in the engine draws from a seeded Rng instance, so
 * `(population, policy vector, engine version, seed)` fully determines a run.
 * This is the mechanism behind the replay guarantee in SIMULATION_LAB_SPEC.md §12.
 */

export interface Rng {
  readonly seed: number;
  /** Uniform in [0, 1). */
  next(): number;
  /** Uniform integer in [0, n). */
  int(n: number): number;
  /** Standard normal (Box–Muller with cached spare). */
  normal(): number;
  /** Lognormal with the given underlying normal parameters. */
  lognormal(mu: number, sigma: number): number;
  pick<T>(items: readonly T[]): T;
  shuffle<T>(items: T[]): T[];
}

export function createRng(seed: number): Rng {
  // mulberry32 — small, fast, and good enough for simulation; not for crypto.
  let a = (seed >>> 0) || 0x9e3779b9;
  let spare: number | null = null;

  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const rng: Rng = {
    seed,
    next,
    int: (n) => Math.floor(next() * n),
    normal() {
      if (spare !== null) {
        const v = spare;
        spare = null;
        return v;
      }
      let u = 0;
      let v = 0;
      let s = 0;
      do {
        u = next() * 2 - 1;
        v = next() * 2 - 1;
        s = u * u + v * v;
      } while (s === 0 || s >= 1);
      const mul = Math.sqrt((-2 * Math.log(s)) / s);
      spare = v * mul;
      return u * mul;
    },
    lognormal(mu, sigma) {
      return Math.exp(mu + sigma * rng.normal());
    },
    pick(items) {
      return items[rng.int(items.length)];
    },
    shuffle(items) {
      for (let i = items.length - 1; i > 0; i -= 1) {
        const j = rng.int(i + 1);
        const tmp = items[i];
        items[i] = items[j];
        items[j] = tmp;
      }
      return items;
    },
  };

  return rng;
}

/** Draw an index from a cumulative distribution. */
export function drawFromCumulative(cumulative: ArrayLike<number>, r: number): number {
  for (let i = 0; i < cumulative.length; i += 1) {
    if (r < cumulative[i]) return i;
  }
  return cumulative.length - 1;
}

/** Convert a distribution into a cumulative array in place-safe fashion. */
export function toCumulative(dist: ArrayLike<number>, out?: Float64Array): Float64Array {
  const target = out ?? new Float64Array(dist.length);
  let acc = 0;
  const n = Math.min(dist.length, target.length);
  for (let i = 0; i < n; i += 1) {
    acc += dist[i];
    target[i] = acc;
  }
  // Guard against floating-point drift so the final draw always lands.
  for (let i = n; i < target.length; i += 1) target[i] = 1;
  target[target.length - 1] = 1;
  return target;
}

/**
 * Distribute `total` items across `weights` proportionally using the
 * largest-remainder method, returning exact integers that sum to `total`.
 *
 * Using this instead of independent sampling is what allows the population
 * generator to hit published Census totals *exactly* rather than approximately.
 */
export function largestRemainderAllocate(weights: number[], total: number): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum <= 0) {
    const out = new Array(weights.length).fill(0);
    if (weights.length > 0) out[0] = total;
    return out;
  }
  const exact = weights.map((w) => (w / sum) * total);
  const floors = exact.map((v) => Math.floor(v));
  let assigned = floors.reduce((a, b) => a + b, 0);
  const remainders = exact
    .map((v, i) => ({ i, frac: v - floors[i] }))
    .sort((x, y) => y.frac - x.frac || x.i - y.i);

  let k = 0;
  while (assigned < total && remainders.length > 0) {
    floors[remainders[k % remainders.length].i] += 1;
    assigned += 1;
    k += 1;
  }
  return floors;
}

/** FNV-1a over a string, rendered as 8 hex chars. Used for population manifests. */
export function fnv1a(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

export function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

export function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

export function mean(values: ArrayLike<number>, count?: number): number {
  const n = count ?? values.length;
  if (n === 0) return 0;
  let sum = 0;
  for (let i = 0; i < n; i += 1) sum += values[i];
  return sum / n;
}

export function gini(values: ArrayLike<number>, count?: number): number {
  const n = count ?? values.length;
  if (n === 0) return 0;
  const sorted = Float64Array.from(values as ArrayLike<number>).slice(0, n);
  sorted.sort();
  let sum = 0;
  let weighted = 0;
  for (let i = 0; i < n; i += 1) {
    sum += sorted[i];
    weighted += (i + 1) * sorted[i];
  }
  if (sum === 0) return 0;
  return (2 * weighted) / (n * sum) - (n + 1) / n;
}

export function quantile(sortedValues: ArrayLike<number>, q: number): number {
  const n = sortedValues.length;
  if (n === 0) return 0;
  const pos = clamp(q, 0, 1) * (n - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sortedValues[lo];
  const frac = pos - lo;
  return sortedValues[lo] * (1 - frac) + sortedValues[hi] * frac;
}
