/**
 * Documentation / terminology consistency tests (spec §3, §5.2, §9; P0.3, P0.4).
 *
 * These are deliberately cheap and catch two classes of regression:
 *   1. the Bayesian-network node count drifting from the code, and
 *   2. the misleading "probability / confidence" uncertainty wording returning.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { BN_EXTENSION_NODES, BN_NODE_COUNT, BN_VERSION, DOMAINS, SEED_ENSEMBLE_DISCLAIMER, NODE_REGISTRY } from "@/simulation";

const read = (rel: string) => readFileSync(path.resolve(process.cwd(), rel), "utf8");

describe("Bayesian-network node count is derived, not hardcoded", () => {
  it("equals the registry length and the DOMAINS key count", () => {
    expect(BN_NODE_COUNT).toBe(NODE_REGISTRY.length);
    expect(BN_NODE_COUNT).toBe(Object.keys(DOMAINS).length);
  });

  it("is 30 and includes the healthcare extension (not deleted to hit an old number)", () => {
    expect(BN_NODE_COUNT).toBe(30);
    expect(BN_EXTENSION_NODES).toEqual(expect.arrayContaining(["HealthInsurance", "HealthBurden"]));
    expect(Object.keys(DOMAINS)).toEqual(expect.arrayContaining(["HealthInsurance", "HealthBurden"]));
    expect(BN_VERSION).toBe("1.1.0");
  });

  it("keeps the documentation quoting the derived count and free of the old '29 nodes' claim", () => {
    const docs = ["README.md", "SIMULATION_LAB_SPEC.md", "docs/BN_STRUCTURE.md"].map((f) => [f, read(f)] as const);
    for (const [file, text] of docs) {
      expect(text, `${file} must quote the current node count`).toContain(String(BN_NODE_COUNT));
      expect(text, `${file} must not claim 29 nodes`).not.toMatch(/29[ -]nodes?/);
    }
  });
});

describe("uncertainty terminology cannot regress to a misleading probability", () => {
  it("ships a single explicit disclaimer constant", () => {
    expect(SEED_ENSEMBLE_DISCLAIMER).toMatch(/share of simulated seed runs/i);
    expect(SEED_ENSEMBLE_DISCLAIMER).toMatch(/not a statistical probability, confidence level or calibrated likelihood/i);
  });

  it("does not describe the seed ensemble as a probability or a 90% confidence interval", () => {
    const sources = ["src/pages/SimulationLab.tsx", "src/simulation/impact.ts"].map((f) => [f, read(f)] as const);
    const banned = [/probability this policy/i, /90% interval/i, /probabilityImproved/i, /\bprobability that\b/i];
    for (const [file, text] of sources) {
      for (const pattern of banned) {
        expect(text, `${file} contains banned uncertainty wording ${pattern}`).not.toMatch(pattern);
      }
    }
  });
});
