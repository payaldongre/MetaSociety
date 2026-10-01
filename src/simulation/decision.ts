/**
 * The decision layer (SIMULATION_LAB_SPEC.md §8).
 *
 * A "System One"-style decision model returns TYPED decisions with calibrated
 * confidence instead of generated text: `Choose` from a declared list, `Score`
 * on a declared rubric, or `Noul` — the probability a declared statement is
 * true. Nothing here can produce a number that appears on a dashboard, which is
 * the point: the design law (§2) forbids a language model from generating an
 * outcome.
 *
 * Three adapters sit behind ONE interface so the simulation is engine-agnostic:
 *
 *   1. RuleDecisionEngine (DEFAULT) — a deterministic threshold rule table.
 *      Fully offline, zero latency, byte-reproducible. This is also the control
 *      condition: if a model-backed engine does not change the simulation
 *      outcome, the typed decisions were not doing the work, and that is worth
 *      reporting.
 *   2. JevDecisionEngine — TypeSafe AI's System One model (announced
 *      15 Sep 2026; early access). ~70-500 ms per batched call, all declared
 *      questions evaluated in parallel, calibrated probabilities, no free-form
 *      output. VERIFY the current endpoint, auth scheme and primitive names
 *      against TypeSafe's docs before relying on it — early-access APIs move.
 *   3. LlmDecisionEngine — constrains a generative LLM to the same declared
 *      answer set. Slower and costlier; the graceful-degradation path.
 *
 * Both remote adapters fall back to the rule engine on any error, and record
 * that they did, so a missing key degrades rather than breaks.
 */

import { clamp01 } from "./rng";
import type {
  ChoiceQuestion,
  Decision,
  DecisionEngine,
  DecisionStats,
  NoulQuestion,
  NoulResult,
  ScoreQuestion,
} from "./types";

export interface DecisionEngineOptions {
  /** Below this confidence the decision is escalated to a human (§8.2 U5). */
  confidenceThreshold?: number;
  /** Remote endpoint for the model-backed adapters. Prefer a server-side proxy. */
  endpoint?: string;
  /**
   * Bearer token for the endpoint. NEVER set this from client-side code: any
   * `import.meta.env.VITE_*` value is compiled into the public bundle. Pass it
   * only from a server/proxy that already holds the provider secret; a proxy
   * endpoint with no client-held key is the supported configuration.
   */
  apiKey?: string;
  timeoutMs?: number;
  /** Deterministic jitter seed for the rule engine's tie-breaking. */
  seed?: number;
}

function softmax(logits: number[]): number[] {
  const max = Math.max(...logits);
  const exps = logits.map((l) => Math.exp(l - max));
  const sum = exps.reduce((a, b) => a + b, 0) || 1;
  return exps.map((e) => e / sum);
}

function normalise(dist: number[]): number[] {
  const sum = dist.reduce((a, b) => a + b, 0);
  return sum > 0 ? dist.map((v) => v / sum) : dist.map(() => 1 / dist.length);
}

/** Track calls, confidence and escalation across a run. */
class StatsTracker {
  private calls = 0;
  private confidenceSum = 0;
  private escalations = 0;
  private fallbacks = 0;

  constructor(
    private readonly engineName: string,
    private readonly threshold: number,
  ) {}

  record(confidence: number): void {
    this.calls += 1;
    this.confidenceSum += confidence;
    if (confidence < this.threshold) this.escalations += 1;
  }

  recordFallback(): void {
    this.fallbacks += 1;
  }

  reset(): void {
    this.calls = 0;
    this.confidenceSum = 0;
    this.escalations = 0;
    this.fallbacks = 0;
  }

  stats(): DecisionStats {
    return {
      engine: this.engineName,
      calls: this.calls,
      escalationRate: this.calls > 0 ? this.escalations / this.calls : 0,
      meanConfidence: this.calls > 0 ? this.confidenceSum / this.calls : 0,
      fallbackUsed: this.fallbacks > 0,
    };
  }
}

/* ------------------------------------------------------------------ */
/* 1. Deterministic rule engine (default, offline)                     */
/* ------------------------------------------------------------------ */

/**
 * Answers declared questions from a numeric situation read, using documented
 * thresholds. No randomness, no network, no model.
 */
export function createRuleDecisionEngine(options: DecisionEngineOptions = {}): DecisionEngine {
  const threshold = options.confidenceThreshold ?? 0.62;
  const stats = new StatsTracker("rule", threshold);

  return {
    name: "rule",

    async choose<T extends string>(_state: string, q: ChoiceQuestion<T>): Promise<Decision<T>> {
      const value = clamp01(q.value);
      const lifts = q.lifts ?? q.options.map((_, i) => 1 - Math.abs(i / Math.max(1, q.options.length - 1) - 0.5) * 2);
      // logits = how strongly the situation favours each option
      const logits = lifts.map((l) => (value - 0.5) * 2 * l * 2.2);
      const dist = softmax(logits);
      let bestIdx = 0;
      for (let i = 1; i < dist.length; i += 1) if (dist[i] > dist[bestIdx]) bestIdx = i;
      const confidence = clamp01(dist[bestIdx] * 0.85 + 0.1);
      stats.record(confidence);
      const distribution: Record<string, number> = {};
      q.options.forEach((opt, i) => {
        distribution[opt] = dist[i];
      });
      return { answer: q.options[bestIdx], distribution, confidence };
    },

    async score(_state: string, q: ScoreQuestion): Promise<Decision> {
      const value = clamp01(q.value);
      const n = q.rubric.length;
      const position = value * (n - 1);
      const dist = q.rubric.map((_, i) => {
        const d = Math.abs(i - position);
        return Math.exp(-(d * d) / 1.2);
      });
      const norm = normalise(dist);
      let bestIdx = 0;
      for (let i = 1; i < norm.length; i += 1) if (norm[i] > norm[bestIdx]) bestIdx = i;
      // Confidence is highest when the situation sits squarely in one band.
      const confidence = clamp01(0.55 + norm[bestIdx] * 0.45);
      stats.record(confidence);
      const distribution: Record<string, number> = {};
      q.rubric.forEach((label, i) => {
        distribution[label] = norm[i];
      });
      return { answer: q.rubric[bestIdx], distribution, confidence };
    },

    async evaluate(_state: string, statements: NoulQuestion[]): Promise<NoulResult[]> {
      return statements.map((s) => {
        const p = clamp01(s.value);
        // Calibrated confidence in a boolean answer: how decided we are.
        const confidence = Math.max(p, 1 - p);
        stats.record(confidence);
        return { key: s.key, probability: p, confidence };
      });
    },

    reset: () => stats.reset(),
    stats: () => stats.stats(),
  };
}

/* ------------------------------------------------------------------ */
/* 2 + 3. Model-backed adapters (remote, with rule fallback)           */
/* ------------------------------------------------------------------ */

interface RemoteAnswer {
  key: string;
  answer?: string;
  probability?: number;
  distribution?: Record<string, number>;
  confidence?: number;
}

/**
 * Shared plumbing for the model-backed adapters. The wire format below is a
 * thin, documented envelope; confirm it against the provider's current API.
 */
function createRemoteEngine(
  name: string,
  options: DecisionEngineOptions,
  fallback: DecisionEngine,
): DecisionEngine {
  const threshold = options.confidenceThreshold ?? 0.62;
  const stats = new StatsTracker(name, threshold);

  const call = async (payload: unknown): Promise<RemoteAnswer[] | null> => {
    if (!options.endpoint) {
      // Unconfigured: record the degradation so the run reports it rather than
      // silently behaving as if the model answered. A missing apiKey is fine —
      // a server-side proxy injects the provider secret.
      stats.recordFallback();
      return null;
    }
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 8000);
      const res = await fetch(options.endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(options.apiKey ? { Authorization: `Bearer ${options.apiKey}` } : {}),
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!res.ok) throw new Error(`decision endpoint responded ${res.status}`);
      const body = (await res.json()) as { answers?: RemoteAnswer[] };
      return body.answers ?? null;
    } catch {
      stats.recordFallback();
      return null;
    }
  };

  return {
    name,

    async choose<T extends string>(state: string, q: ChoiceQuestion<T>): Promise<Decision<T>> {
      const answers = await call({
        state,
        questions: [{ kind: "choice", key: q.key, prompt: q.prompt, options: q.options, signals: { value: q.value } }],
      });
      const a = answers?.find((x) => x.key === q.key);
      if (!a || typeof a.answer !== "string" || !q.options.includes(a.answer as T)) {
        return fallback.choose(state, q);
      }
      const distribution = a.distribution ?? { [a.answer]: 1 };
      const confidence = clamp01(a.confidence ?? distribution[a.answer] ?? 0.6);
      stats.record(confidence);
      return { answer: a.answer as T, distribution, confidence };
    },

    async score(state: string, q: ScoreQuestion): Promise<Decision> {
      const answers = await call({
        state,
        questions: [{ kind: "score", key: q.key, prompt: q.prompt, rubric: q.rubric, signals: { value: q.value } }],
      });
      const a = answers?.find((x) => x.key === q.key);
      if (!a || typeof a.answer !== "string" || !q.rubric.includes(a.answer)) {
        return fallback.score(state, q);
      }
      const distribution = a.distribution ?? { [a.answer]: 1 };
      const confidence = clamp01(a.confidence ?? 0.6);
      stats.record(confidence);
      return { answer: a.answer, distribution, confidence };
    },

    async evaluate(state: string, statements: NoulQuestion[]): Promise<NoulResult[]> {
      const answers = await call({
        state,
        statements: statements.map((s) => ({ key: s.key, statement: s.statement, signals: { value: s.value } })),
      });
      if (!answers) return fallback.evaluate(state, statements);
      return statements.map((s) => {
        const a = answers.find((x) => x.key === s.key);
        const probability = clamp01(a?.probability ?? s.value);
        const confidence = clamp01(a?.confidence ?? Math.max(probability, 1 - probability));
        stats.record(confidence);
        return { key: s.key, probability, confidence };
      });
    },

    reset: () => stats.reset(),
    stats: () => stats.stats(),
  };
}

/**
 * Jev — TypeSafe AI's System One decision model.
 * `state` in, typed decisions out, calibrated probabilities, no prose.
 */
export function createJevDecisionEngine(options: DecisionEngineOptions = {}): DecisionEngine {
  return createRemoteEngine("jev", options, createRuleDecisionEngine(options));
}

/** A generative LLM constrained to the same declared answer set. */
export function createLlmDecisionEngine(options: DecisionEngineOptions = {}): DecisionEngine {
  return createRemoteEngine("llm-schema-constrained", options, createRuleDecisionEngine(options));
}

export type DecisionEngineKind = "rule" | "jev" | "llm";

/**
 * Select an adapter. Defaults to `rule`, which is deliberate: the simulation
 * must be fully functional, deterministic and offline-capable without any
 * third-party decision model configured.
 */
export function createDecisionEngine(
  kind: DecisionEngineKind = "rule",
  options: DecisionEngineOptions = {},
): DecisionEngine {
  switch (kind) {
    case "jev":
      return createJevDecisionEngine(options);
    case "llm":
      return createLlmDecisionEngine(options);
    default:
      return createRuleDecisionEngine(options);
  }
}
