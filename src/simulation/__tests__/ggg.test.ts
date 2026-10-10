/**
 * GGG — historical-policy inheritance tests.
 *
 * These assert the properties the mechanism must have to be trustworthy:
 *   - the registry is real and provenanced, with no fabricated magnitudes;
 *   - matching is deterministic and mechanism-driven (a housing policy does not
 *     inherit an employment effect merely because both are public programmes);
 *   - inheritance is deterministic and conservative;
 *   - the grounded effect scale is derived and bounded, not chosen for looks;
 *   - lineage runs predecessor → child → simulation;
 *   - GGG participates in the real simulation and cannot copy a historical
 *     outcome into a result.
 *
 * Pure by default: matching/inheritance need no population roll. The single
 * end-to-end check runs the real engine once.
 */

import { describe, expect, it } from "vitest";

import {
  CHANNELS,
  HISTORICAL_POLICIES,
  MIN_EFFECT_SCALE,
  MIN_PARENT_SCORE,
  NO_PARENT_COMPARABILITY,
  PANDHARPUR_CONTEXT,
  SIMILARITY_WEIGHTS,
  genomeFromPolicy,
  groundedParameters,
  inheritTraits,
  matchHistoricalParents,
  runGgg,
  similarityTo,
} from "@/simulation";
import { BN_VERSION } from "@/simulation";
import { runSimulation } from "@/simulation/simulate";
import type { PolicyVector } from "@/simulation/types";

const policy = (o: Partial<PolicyVector> = {}): PolicyVector => ({
  channelIds: ["INCOME_SUPPORT"],
  name: "Local income support",
  intensity: 0.65,
  budget: 12e7,
  durationMonths: 24,
  allocation: { housing: 0.3, education: 0.4, employment: 0.3 },
  ...o,
});

/* ------------------------------------------------------------------ */
/* Registry integrity                                                  */
/* ------------------------------------------------------------------ */

describe("historical policy registry", () => {
  it("cites evidence and a comparability note for every entry", () => {
    expect(HISTORICAL_POLICIES.length).toBeGreaterThanOrEqual(8);
    for (const p of HISTORICAL_POLICIES) {
      expect(p.sources.length).toBeGreaterThan(0);
      expect(p.evidenceStrength).toBeTruthy();
      expect(p.comparability.length).toBeGreaterThan(10);
      expect(p.uncertainty.length).toBeGreaterThan(10);
      expect(p.mechanismTags.length).toBeGreaterThan(0);
      // The channel must be one the engine actually knows.
      expect(CHANNELS[p.channel]).toBeTruthy();
    }
  });

  it("never invents a magnitude — every magnitude is sourced and labelled", () => {
    for (const p of HISTORICAL_POLICIES) {
      for (const o of p.observedOutcomes) {
        if (o.magnitude) {
          // A magnitude must be an observed/historical number with a real source,
          // never a model assumption dressed as data.
          expect(["OBSERVED", "HISTORICAL_OUTCOME"]).toContain(o.category);
          expect(o.source.sourceType).toBeTruthy();
          expect(o.source.title).toBeTruthy();
        } else {
          // A direction without a magnitude may still be observed; what is not
          // allowed is a NUMBER presented as observed without a real source.
          expect(["EMPIRICAL_RELATIONSHIP", "HISTORICAL_OUTCOME", "OBSERVED"]).toContain(o.category);
        }
      }
    }
  });

  it("covers both optimistic and contested predecessors (no survivorship bias)", () => {
    const ids = HISTORICAL_POLICIES.map((p) => p.id);
    expect(ids).toContain("mgnrega-2005");
    expect(ids).toContain("pm-svanidhi-2020");
    expect(ids).toContain("pandharpur-corridor-2026");
    // The corridor's documented outcome is contested; it must be present.
    const corridor = HISTORICAL_POLICIES.find((p) => p.id === "pandharpur-corridor-2026")!;
    expect(corridor.observedOutcomes[0].direction).toBe("unclear");
    expect(corridor.sideEffects.join(" ")).toMatch(/protest/i);
  });
});

/* ------------------------------------------------------------------ */
/* Genome                                                              */
/* ------------------------------------------------------------------ */

describe("policy genome", () => {
  it("is deterministic and reads characteristics from the channel dictionary", () => {
    const a = genomeFromPolicy(policy());
    const b = genomeFromPolicy(policy());
    expect(a).toEqual(b);
    expect(a.channelIds).toEqual(["INCOME_SUPPORT"]);
    expect(a.mechanismTags).toContain("cash_transfer");
    expect(a.scale).toBe("local");
    expect(a.authorityLevel).toBe("local");
  });

  it("marks a pilgrimage policy seasonal and a housing policy not", () => {
    expect(genomeFromPolicy(policy({ channelIds: ["PILGRIMAGE_FACILITIES"] })).seasonality).toBe("seasonal");
    expect(genomeFromPolicy(policy({ channelIds: ["HOUSING"] })).seasonality).toBe("none");
  });
});

/* ------------------------------------------------------------------ */
/* Matching                                                            */
/* ------------------------------------------------------------------ */

describe("historical parent matching", () => {
  it("uses documented weights that sum to 1", () => {
    const sum = Object.values(SIMILARITY_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(Math.abs(sum - 1)).toBeLessThan(1e-9);
  });

  it("selects mechanism-relevant parents and never a mere government-programme default", () => {
    const housing = matchHistoricalParents(genomeFromPolicy(policy({ channelIds: ["HOUSING"] })));
    const ids = housing.map((p) => p.policyId);
    // The housing mission is a parent; the employment guarantee must NOT be,
    // because there is no defensible mechanism overlap.
    expect(ids).toContain("pmay-urban");
    expect(ids).not.toContain("mgnrega-2005");

    const employment = matchHistoricalParents(genomeFromPolicy(policy({ channelIds: ["LABOR_MARKET"] })));
    expect(employment.map((p) => p.policyId)).toContain("mgnrega-2005");
  });

  it("matches the Wari pilgrimage policy to the real Wari predecessor", () => {
    const parents = matchHistoricalParents(genomeFromPolicy(policy({ channelIds: ["PILGRIMAGE_FACILITIES"] })));
    expect(parents.map((p) => p.policyId)).toContain("wari-toll-exemption");
  });

  it("is deterministic and explainable, with a machine-readable breakdown", () => {
    const g = genomeFromPolicy(policy({ channelIds: ["LABOR_MARKET"] }));
    const a = matchHistoricalParents(g);
    const b = matchHistoricalParents(g);
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(0);
    for (const p of a) {
      expect(p.overall).toBeGreaterThanOrEqual(0);
      expect(p.overall).toBeLessThanOrEqual(1);
      expect(p.reason).toMatch(/mechanism|channel|pathway|target|context|weak evidence/);
      expect(Object.keys(p.breakdown).sort()).toEqual(
        ["causalNodes", "channel", "context", "duration", "mechanism", "scale", "seasonality", "target"].sort(),
      );
    }
  });

  it("returns no parent for a channel with no real predecessor", () => {
    // No historical programme in the registry is a tax/fiscal predecessor.
    expect(matchHistoricalParents(genomeFromPolicy(policy({ channelIds: ["TAX_FISCAL"] })))).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* Inheritance + adaptation                                            */
/* ------------------------------------------------------------------ */

describe("GGG inheritance and adaptation", () => {
  it("inherits traits only with parent support, and reports which parents", () => {
    const g = genomeFromPolicy(policy({ channelIds: ["LABOR_MARKET"] }));
    const parents = matchHistoricalParents(g);
    const traits = inheritTraits(g, parents);
    expect(traits.length).toBeGreaterThan(0);
    for (const t of traits) {
      expect(t.supportingParents.length).toBeGreaterThan(0);
      expect(t.confidence).toBeGreaterThan(0);
      expect(t.confidence).toBeLessThanOrEqual(1);
    }
    expect(inheritTraits(g, [])).toEqual([]);
  });

  it("is deterministic", () => {
    const g = genomeFromPolicy(policy({ channelIds: ["LABOR_MARKET"] }));
    expect(inheritTraits(g, matchHistoricalParents(g))).toEqual(inheritTraits(g, matchHistoricalParents(g)));
  });

  it("adapts to Pandharpur: population, Wari seasonality, governance and scale", () => {
    const g = runGgg(policy({ channelIds: ["PILGRIMAGE_FACILITIES"] }));
    const dims = g.adaptation.map((a) => a.dimension);
    expect(dims).toContain("Population");
    expect(dims).toContain("Seasonality");
    expect(dims).toContain("Governance");
    const season = g.adaptation.find((a) => a.dimension === "Seasonality")!;
    expect(season.pandharpur).toMatch(/Wari/);
    expect(season.note).toMatch(/never as extra residents/);
    expect(g.adaptation.find((a) => a.dimension === "Population")!.pandharpur).toContain(
      PANDHARPUR_CONTEXT.residents.toLocaleString("en-IN"),
    );
  });
});

/* ------------------------------------------------------------------ */
/* Grounded effect scale                                               */
/* ------------------------------------------------------------------ */

describe("grounded effect scale", () => {
  it("is bounded, derived from named factors, and never copies a historical magnitude", () => {
    const g = runGgg(policy({ channelIds: ["LABOR_MARKET"] }));
    const gs = g.grounded.effectScale;
    expect(gs).toBeGreaterThanOrEqual(MIN_EFFECT_SCALE);
    expect(gs).toBeLessThanOrEqual(1);
    expect(g.grounded.rationale.join(" ")).toMatch(/no historical outcome magnitude is copied/);
    expect(g.grounded.rationale.length).toBeGreaterThanOrEqual(5);
  });

  it("uses the documented no-parent comparability when nothing matches", () => {
    const g = runGgg(policy({ channelIds: ["TAX_FISCAL"] }));
    expect(g.parents).toEqual([]);
    expect(g.grounded.comparability).toBe(NO_PARENT_COMPARABILITY);
    expect(g.grounded.effectScale).toBeGreaterThan(0);
    expect(g.notes.join(" ")).toMatch(/No historical predecessor/i);
  });

  it("scales with comparability: a closer predecessor yields a larger scale", () => {
    // A state-scale income-support predecessor (Ladki Bahin) is administratively
    // closer than a national one (PM-KISAN), so a Maharashtra-level child is
    // grounded more strongly than a local one is.
    const local = groundedParameters(
      { ...genomeFromPolicy(policy({ channelIds: ["INCOME_SUPPORT"] })), scale: "local" },
      matchHistoricalParents(genomeFromPolicy(policy({ channelIds: ["INCOME_SUPPORT"] }))),
    );
    const district = groundedParameters(
      { ...genomeFromPolicy(policy({ channelIds: ["INCOME_SUPPORT"] })), scale: "district" },
      matchHistoricalParents(genomeFromPolicy(policy({ channelIds: ["INCOME_SUPPORT"] }))),
    );
    expect(district.effectScale).toBeGreaterThanOrEqual(local.effectScale);
  });

  it("reports lineage from predecessor through to the simulation", () => {
    const g = runGgg(policy({ channelIds: ["LABOR_MARKET"] }));
    const steps = g.lineage.map((l) => l.step);
    expect(steps[0]).toBe("Proposed policy");
    expect(steps).toContain("Policy genome");
    expect(steps).toContain("Historical parents");
    expect(steps).toContain("GGG inheritance");
    expect(steps).toContain("Pandharpur adaptation");
    expect(steps[steps.length - 1]).toBe("Result + uncertainty");
    expect(g.lineage.find((l) => l.step === "Historical parents")!.detail).toMatch(/MGNREGA/);
  });

  it("never grounds a no-parent policy more strongly than a matched one", () => {
    // Structural invariant: absence of historical evidence must be WEAKER than
    // the weakest admissible predecessor, never stronger.
    expect(NO_PARENT_COMPARABILITY).toBeLessThan(MIN_PARENT_SCORE);
    const noParent = groundedParameters(genomeFromPolicy(policy({ channelIds: ["TAX_FISCAL"] })), []);
    // A synthetic weakest-admissible matched parent (score exactly MIN_PARENT_SCORE).
    const weakParent = {
      policyId: "weak",
      name: "Weak predecessor",
      channel: "INCOME_SUPPORT",
      scale: "local",
      overall: MIN_PARENT_SCORE,
      breakdown: { channel: 1, mechanism: 0, causalNodes: 0, target: 0, context: 0, seasonality: 0, scale: 1, duration: 0.5 },
      reason: "",
      sharedTags: [],
      sharedNodes: [],
      evidenceStrength: "uncalibrated",
    } as Parameters<typeof groundedParameters>[1][number];
    const matched = groundedParameters(genomeFromPolicy(policy({ channelIds: ["INCOME_SUPPORT"] })), [weakParent]);
    expect(matched.effectScale).toBeGreaterThanOrEqual(noParent.effectScale);
  });

  it("leaves the magnitude uncalibrated unless a parent observed the same engine metric", () => {
    // MGNREGA's direction is supported but its magnitude is not evaluated on the
    // engine's mean-income metric as a directly observed number.
    const g = runGgg(policy({ channelIds: ["LABOR_MARKET"] }));
    expect(g.magnitudeCalibration).toBe("uncalibrated");
    expect(g.notes.join(" ")).toMatch(/magnitude is uncalibrated/i);
  });
});

/* ------------------------------------------------------------------ */
/* Integration into the real engine                                    */
/* ------------------------------------------------------------------ */

describe("GGG participates in the simulation", () => {
  it(
    "attaches the inheritance and grounds the effect scale the engine used",
    async () => {
      const p = policy({ channelIds: ["LABOR_MARKET"], budget: 12e7, intensity: 0.65 });
      const res = await runSimulation(
        { townId: "pandharpur_in_mh", policy: p, mode: "single", seed: 20260101, bnVersion: BN_VERSION, zoneFilter: "all" },
        { intervalRounds: 1 },
      );
      expect(res.ggg).toBeDefined();
      const g = res.ggg!;
      expect(g.parents.map((x) => x.policyId)).toContain("mgnrega-2005");
      expect(g.grounded.effectScale).toBe(runGgg(p).grounded.effectScale);
      expect(res.warnings.some((w) => /GGG grounded effect scale/.test(w))).toBe(true);

      // GGG cannot make the result equal to a historical outcome: the engine's
      // employment delta stays a small, bounded movement, not the historical
      // programme's own reported effect.
      const empDelta = res.point.employmentRatePct - res.baseline.employmentRatePct;
      expect(Math.abs(empDelta)).toBeLessThan(10);
      expect(Math.abs(res.point.gdpGrowthPct)).toBeLessThan(20);

      // GGG lineage is preserved through to the run.
      expect(g.lineage.map((l) => l.step)).toContain("Causal simulation");
    },
    180_000,
  );
});
