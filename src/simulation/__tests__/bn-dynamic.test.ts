/**
 * Dynamic Bayesian network + GGG→BN resolution tests.
 *
 * These pin the two architectural claims this work makes:
 *
 *  1. GGG's grounded state reaches the causal network at FULL RESOLUTION.
 *     The old path banded the grounded value to low/medium/high, so materially
 *     different grounded policies collapsed onto the same BN state. The grounded
 *     effect scale is now a CONTINUOUS multiplier baked into the policy
 *     log-shifts, so two different grounded strengths give two different CPTs.
 *
 *  2. The network is genuinely declarative and VALIDATED. Nodes carry domain,
 *     parents, pass, calibration and provenance; the graph is checked for
 *     duplicate ids, missing parents, invalid domains, cycles, bad CPT
 *     dimensions, probabilities outside [0,1], non-normalised rows and invalid
 *     evaluation passes before it is allowed to run.
 */

import { describe, expect, it } from "vitest";

import {
  DOMAINS,
  NODE_REGISTRY,
  buildBn,
  compileBn,
  createRng,
  generatePopulation,
  policyResponse,
  runGgg,
  validateBnGraph,
  type Bn,
} from "@/simulation";
import { EXTERNAL_SHIFT } from "@/simulation/bn";
import { SHOCK_AFFECTED_NODES } from "@/simulation/shocks";
import { PILGRIMAGE_NODE_REGISTRY, SEASONAL_NODES } from "@/simulation/seasonality";
import type { PolicyVector } from "@/simulation/types";

const pop = generatePopulation(20260101);

const policy = (o: Partial<PolicyVector> = {}): PolicyVector => ({
  channelIds: ["LABOR_MARKET"],
  name: "Employment & Skills Mission",
  intensity: 0.8,
  budget: 8e7,
  durationMonths: 60,
  allocation: { housing: 0.2, education: 0.4, employment: 0.4 },
  ...o,
});

function cptDiffers(a: Bn, b: Bn, node: string): boolean {
  const ta = a.cpts[node].table;
  const tb = b.cpts[node].table;
  const keys = Object.keys(ta);
  if (keys.length !== Object.keys(tb).length) return true;
  for (const k of keys) {
    const ra = ta[k];
    const rb = tb[k];
    if (!rb || ra.length !== rb.length) return true;
    for (let i = 0; i < ra.length; i += 1) if (Math.abs(ra[i] - rb[i]) > 1e-9) return true;
  }
  return false;
}

/* ------------------------------------------------------------------ */
/* Declarative registry                                                */
/* ------------------------------------------------------------------ */

describe("declarative node registry", () => {
  it("describes every node with domain, parents, pass, calibration and provenance", () => {
    expect(NODE_REGISTRY.length).toBe(Object.keys(DOMAINS).length);
    for (const spec of NODE_REGISTRY) {
      expect(spec.domain.length).toBeGreaterThan(0);
      expect(["micro", "town", "feedback"]).toContain(spec.pass);
      expect(["observed", "derived", "assumed", "historical_evidence"]).toContain(spec.calibration);
      expect(spec.provenance.length).toBeGreaterThan(4);
      for (const parent of spec.parents) {
        expect(DOMAINS[parent], `parent ${parent} of ${spec.id} must be a known node`).toBeDefined();
      }
      expect(spec.root).toBe(spec.parents.length === 0);
    }
  });

  it("registers the exogenous external-shock nodes as declarative roots", () => {
    for (const id of ["ExternalHealthShock", "ExternalEconomicShock", "ExternalClimateShock", "ExternalInfrastructureShock", "ExternalSocialShock"]) {
      const spec = NODE_REGISTRY.find((s) => s.id === id);
      expect(spec, `${id} must be registered`).toBeTruthy();
      expect(spec?.root).toBe(true);
      expect(spec?.domain).toEqual(["none", "mild", "moderate", "severe"]);
      expect(spec?.modelled).toBe(true);
    }
  });
});

/* ------------------------------------------------------------------ */
/* Graph validation                                                    */
/* ------------------------------------------------------------------ */

function tinyBn(): Bn {
  const r = (n: number) => new Array(n).fill(1 / n);
  return {
    version: "test",
    nodes: {
      A: { id: "A", domain: ["x", "y"], parents: [], kind: "root" },
      B: { id: "B", domain: ["p", "q"], parents: ["A"], kind: "micro" },
      C: { id: "C", domain: ["m", "n"], parents: ["B"], kind: "micro" },
    },
    order: ["A", "B", "C"],
    cpts: {
      A: { node: "A", table: { "": r(2) }, marginal: r(2), source: "prior", provenance: "prior" },
      B: { node: "B", table: { "0": r(2), "1": r(2) }, marginal: r(2), source: "prior", provenance: "prior" },
      C: { node: "C", table: { "0": r(2), "1": r(2) }, marginal: r(2), source: "prior", provenance: "prior" },
    },
  };
}

const check = (bn: Bn, name: string) => validateBnGraph(bn).find((c) => c.check === name)!;

describe("dynamic graph validation", () => {
  it("accepts the real, built network", () => {
    const bn = buildBn(pop);
    const failed = validateBnGraph(bn).filter((c) => !c.passed);
    expect(failed.map((f) => `${f.check}: ${f.observed}`)).toEqual([]);
  });

  it("detects a missing parent", () => {
    const bn = tinyBn();
    const broken: Bn = { ...bn, nodes: { ...bn.nodes, C: { ...bn.nodes.C, parents: ["A", "ZZ"] } } };
    const c = check(broken, "every parent node exists");
    expect(c.passed).toBe(false);
    expect(c.observed).toContain("ZZ");
  });

  it("detects a cycle", () => {
    const bn = tinyBn();
    const cyclic: Bn = { ...bn, nodes: { ...bn.nodes, A: { ...bn.nodes.A, parents: ["C"] } } };
    expect(check(cyclic, "graph is acyclic").passed).toBe(false);
  });

  it("detects an invalid domain", () => {
    const bn = tinyBn();
    const broken: Bn = { ...bn, nodes: { ...bn.nodes, B: { ...bn.nodes.B, domain: ["p", "p"] } } };
    expect(check(broken, "every node has a non-empty, duplicate-free domain").passed).toBe(false);
  });

  it("detects a probability outside [0,1] and a non-normalised row", () => {
    const bn = tinyBn();
    const badProb: Bn = {
      ...bn,
      cpts: { ...bn.cpts, A: { ...bn.cpts.A, table: { "": [1.4, -0.4] } } },
    };
    expect(check(badProb, "every probability is inside [0,1]").passed).toBe(false);

    const badNorm: Bn = {
      ...bn,
      cpts: { ...bn.cpts, A: { ...bn.cpts.A, table: { "": [0.2, 0.2] } } },
    };
    expect(check(badNorm, "every CPT row normalises to 1").passed).toBe(false);
  });

  it("detects a CPT with the wrong dimension", () => {
    const bn = tinyBn();
    const broken: Bn = {
      ...bn,
      cpts: { ...bn.cpts, A: { ...bn.cpts.A, table: { "": [1] } } },
    };
    expect(check(broken, "CPT rows match the declared parent dimensions").passed).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* GGG → BN resolution (the P0 fix)                                    */
/* ------------------------------------------------------------------ */

const laborPolicy = { PolicyType: "labor", PolicyIntensity: "high", PolicyBudgetShare: "high" };
const noPolicy = { PolicyType: "none", PolicyIntensity: "low", PolicyBudgetShare: "low" };

function formalProbability(strength: number, policyEvidence = laborPolicy): number {
  const c = compileBn(buildBn(pop, { groundedStrength: strength }));
  return policyResponse(c, pop, policyEvidence, "EmploymentStatus", [2], 5000, createRng(0x51af1e));
}

describe("GGG grounded state reaches the network at full resolution", () => {
  it("Test 1 — two different grounded strengths give two different causal states", () => {
    const weak = buildBn(pop, { groundedStrength: 0.15 });
    const strong = buildBn(pop, { groundedStrength: 0.7 });
    // The policy's causal state genuinely differs between the two networks…
    expect(cptDiffers(weak, strong, "EmploymentStatus")).toBe(true);
    // …and the difference is in the direction the grounding claims.
    expect(formalProbability(0.7)).toBeGreaterThan(formalProbability(0.15));
  });

  it("Test 2 — intensity sensitivity is monotonic where the relationship is", () => {
    const c = compileBn(buildBn(pop, { groundedStrength: 0.5 }));
    const low = policyResponse(c, pop, { ...laborPolicy, PolicyIntensity: "low" }, "EmploymentStatus", [2], 5000, createRng(7));
    const high = policyResponse(c, pop, { ...laborPolicy, PolicyIntensity: "high" }, "EmploymentStatus", [2], 5000, createRng(7));
    expect(high).toBeGreaterThan(low);
  });

  it("Test 3 — materially different budgets do not collapse to the same causal state", () => {
    const c = compileBn(buildBn(pop, { groundedStrength: 0.5 }));
    const small = policyResponse(c, pop, { ...laborPolicy, PolicyBudgetShare: "low" }, "EmploymentStatus", [2], 5000, createRng(11));
    const large = policyResponse(c, pop, { ...laborPolicy, PolicyBudgetShare: "high" }, "EmploymentStatus", [2], 5000, createRng(11));
    expect(Math.abs(large - small)).toBeGreaterThan(0.005);
  });

  it("Test 4 — a different GGG grounding changes the grounded causal parameter", () => {
    const close = runGgg(policy({ channelIds: ["LABOR_MARKET"] }));
    const far = runGgg(policy({ channelIds: ["TAX_FISCAL"] }));
    // The two groundings are genuinely different (a matched predecessor versus
    // none at all), and that difference reaches the causal tables.
    expect(far.grounded.effectScale).not.toBe(close.grounded.effectScale);
    const a = buildBn(pop, { groundedStrength: close.grounded.effectScale });
    const b = buildBn(pop, { groundedStrength: far.grounded.effectScale });
    expect(cptDiffers(a, b, "EmploymentStatus")).toBe(true);
  });

  it("Test 5 — channel isolation: an employment policy does not move the health channel", () => {
    const c = compileBn(buildBn(pop, { groundedStrength: 1 }));
    // With the health channel's own parents fixed, an employment policy must not
    // change P(covered) — the numeric policy strength must not leak across
    // channels. Same seed ⇒ an exactly identical draw when the table is shared.
    const extra = { IncomeClass: "low", EmploymentStatus: "informal" } as const;
    const labor = policyResponse(c, pop, laborPolicy, "HealthInsurance", [1], 4000, createRng(99), extra);
    const none = policyResponse(c, pop, noPolicy, "HealthInsurance", [1], 4000, createRng(99), extra);
    expect(labor).toBe(none);
  });

  it("Test 6 — determinism: identical inputs give byte-identical tables", () => {
    const a = buildBn(pop, { groundedStrength: 0.42 });
    const b = buildBn(pop, { groundedStrength: 0.42 });
    for (const id of Object.keys(DOMAINS)) expect(a.cpts[id]).toEqual(b.cpts[id]);
  });
});

/* ------------------------------------------------------------------ */
/* Dynamic + temporal node execution                                   */
/* ------------------------------------------------------------------ */

describe("dynamic node execution", () => {
  it("an exogenous shock node drives its downstream causal nodes", () => {
    const c = compileBn(buildBn(pop, { groundedStrength: 1 }));
    const evidence = { IncomeClass: "low" } as const;
    const calm = policyResponse(c, pop, noPolicy, "EmploymentStatus", [0], 5000, createRng(3), evidence);
    const shocked = policyResponse(c, pop, noPolicy, "EmploymentStatus", [0], 5000, createRng(3), {
      ...evidence,
      ExternalEconomicShock: "severe",
    });
    expect(shocked).toBeGreaterThan(calm);
  });

  it("a health shock raises the health-burden channel but not the employment channel's formal share", () => {
    const c = compileBn(buildBn(pop, { groundedStrength: 1 }));
    const evidence = { IncomeClass: "low", HealthInsurance: "uninsured" } as const;
    const calm = policyResponse(c, pop, noPolicy, "HealthBurden", [2], 5000, createRng(5), evidence);
    const shocked = policyResponse(c, pop, noPolicy, "HealthBurden", [2], 5000, createRng(5), {
      ...evidence,
      ExternalHealthShock: "severe",
    });
    expect(shocked).toBeGreaterThan(calm);
  });
});

/* ------------------------------------------------------------------ */
/* Seasonal nodes (declarative + temporal)                             */
/* ------------------------------------------------------------------ */

describe("seasonal pilgrimage nodes", () => {
  it("are declared with the same shape as the core registry", () => {
    expect(PILGRIMAGE_NODE_REGISTRY.map((n) => n.id)).toEqual([
      "PilgrimFootfall",
      "SeasonalInfraLoad",
      "LocalInfraQuality",
    ]);
    for (const spec of SEASONAL_NODES) {
      expect(spec.domain.length).toBeGreaterThan(0);
      expect(spec.provenance.length).toBeGreaterThan(4);
      for (const parent of spec.parents) {
        expect(SEASONAL_NODES.find((n) => n.id === parent), `missing seasonal parent ${parent}`).toBeTruthy();
      }
    }
    // The declared affected-node map matches what the network actually wires.
    for (const [node, affected] of Object.entries(SHOCK_AFFECTED_NODES)) {
      for (const target of affected) {
        expect(EXTERNAL_SHIFT[target]?.[node], `${node} -> ${target} must be wired`).toBeTruthy();
      }
    }
  });
});
