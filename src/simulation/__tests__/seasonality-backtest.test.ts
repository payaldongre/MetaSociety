/**
 * Wari seasonal model + historical backtesting tests
 * (redesign spec §9–§17, §38).
 *
 * Cheap: seasonal evaluation and backtesting are pure — no population roll.
 */

import { describe, expect, it } from "vitest";

import {
  FOOTFALL_BANDS,
  FOOTFALL_CPT,
  LOAD_CPT,
  PILGRIMAGE_NODE_REGISTRY,
  QUALITY_CPT,
  buildSeasonalProfile,
  localInfraPolicyFor,
  pilgrimageExposureFor,
  seasonForMonthOfYear,
} from "@/simulation/seasonality";
import { BACKTEST_CASES, checkNoLeakage, runBacktest, runBacktestSuite } from "@/simulation/backtest";
import { CALIBRATION_LEDGER, ledgerSummary } from "@/simulation/calibration-ledger";

describe("Wari calendar", () => {
  it("maps June–July to peak Wari, adjacent months to shoulder, else off", () => {
    expect(seasonForMonthOfYear(6)).toBe("peak_wari");
    expect(seasonForMonthOfYear(7)).toBe("peak_wari");
    expect(seasonForMonthOfYear(5)).toBe("shoulder");
    expect(seasonForMonthOfYear(8)).toBe("shoulder");
    expect(seasonForMonthOfYear(1)).toBe("off");
  });
});

describe("pilgrimage nodes (spec §11)", () => {
  it("registers PilgrimFootfall, SeasonalInfraLoad and LocalInfraQuality with full spec fields", () => {
    const ids = PILGRIMAGE_NODE_REGISTRY.map((n) => n.id);
    expect(ids).toContain("PilgrimFootfall");
    expect(ids).toContain("SeasonalInfraLoad");
    expect(ids).toContain("LocalInfraQuality");

    const footfall = PILGRIMAGE_NODE_REGISTRY.find((n) => n.id === "PilgrimFootfall")!;
    expect(footfall.parents).toEqual(["PilgrimSeason", "PilgrimPolicyExposure"]);
    const load = PILGRIMAGE_NODE_REGISTRY.find((n) => n.id === "SeasonalInfraLoad")!;
    expect(load.parents).toEqual(["PilgrimFootfall"]);
    const quality = PILGRIMAGE_NODE_REGISTRY.find((n) => n.id === "LocalInfraQuality")!;
    expect(quality.parents).toEqual(["LocalInfraPolicy"]);

    for (const n of PILGRIMAGE_NODE_REGISTRY) {
      expect(n.domain.length).toBeGreaterThan(1);
      expect(n.pass).toBe("seasonal");
      expect(n.provenance).toBeTruthy();
      expect(n.modelled).toBe(true);
      // No modelled CPT may be presented as observed.
      expect(n.cptSource).not.toBe("observed");
      expect(n.calibrationStatus).toBeTruthy();
    }
  });

  it("ships normalised CPT rows", () => {
    for (const cpt of [FOOTFALL_CPT, LOAD_CPT, QUALITY_CPT]) {
      for (const key of Object.keys(cpt)) {
        const sum = cpt[key].reduce((a, b) => a + b, 0);
        expect(Math.abs(sum - 1)).toBeLessThan(1e-9);
      }
    }
    expect(FOOTFALL_CPT["peak_wari|none"].length).toBe(FOOTFALL_BANDS.length);
  });
});

describe("seasonal exposure and local infra policy", () => {
  it("derives exposure from the pilgrimage channel and intensity", () => {
    expect(pilgrimageExposureFor(["HOUSING"], 0.9)).toBe("none");
    expect(pilgrimageExposureFor(["PILGRIMAGE_FACILITIES"], 0.8)).toBe("full");
    expect(pilgrimageExposureFor(["PILGRIMAGE_FACILITIES"], 0.3)).toBe("limited");
  });

  it("derives the local infra policy from the policy's channels", () => {
    expect(localInfraPolicyFor(["INFRASTRUCTURE"])).toBe("expanded");
    expect(localInfraPolicyFor(["PILGRIMAGE_FACILITIES"])).toBe("steady");
    expect(localInfraPolicyFor(["HOUSING"])).toBe("constrained");
    expect(localInfraPolicyFor([])).toBe("constrained");
  });
});

describe("Wari produces a visible seasonal effect (spec §12)", () => {
  const seasonalOnly = buildSeasonalProfile({
    periods: 12,
    monthsEach: 3,
    startMonth: 1,
    channelIds: ["PILGRIMAGE_FACILITIES"],
    intensity: 0.8,
  });

  it("shows a measurable step during Wari relative to non-Wari periods", () => {
    expect(seasonalOnly.points.some((p) => p.inWari)).toBe(true);
    expect(seasonalOnly.points.some((p) => !p.inWari)).toBe(true);
    expect(seasonalOnly.wariStep).toBeGreaterThan(0.05);
    expect(seasonalOnly.peakPressure).toBeGreaterThan(0);
  });

  it("never adds permanent residents: pressure is a per-period overlay, not population", () => {
    // The profile is a time series of pressure indices; every value is <= 1 and
    // it returns to the baseline outside Wari.
    for (const p of seasonalOnly.points) {
      expect(p.civicPressure).toBeGreaterThanOrEqual(0);
      expect(p.civicPressure).toBeLessThanOrEqual(1);
    }
    const off = seasonalOnly.points.filter((p) => p.season === "off");
    for (const p of off) expect(p.civicPressure).toBeLessThan(0.2);
  });

  it("changes when the pilgrimage policy's exposure changes", () => {
    const off = buildSeasonalProfile({ periods: 12, monthsEach: 3, startMonth: 1, channelIds: [], intensity: 0 });
    expect(seasonalOnly.exposure).not.toBe(off.exposure);
    expect(seasonalOnly.points.some((p, i) => p.civicPressure !== off.points[i]?.civicPressure)).toBe(true);
  });
});

describe("general policies do not acquire pilgrimage effects (spec §10)", () => {
  for (const channels of [["HOUSING"], ["HEALTHCARE_ACCESS"], ["LABOR_MARKET"], ["EDUCATION_SKILL"]]) {
    it(`${channels[0]} carries no pilgrimage component`, () => {
      const baseline = buildSeasonalProfile({ periods: 8, monthsEach: 3, startMonth: 1, channelIds: [], intensity: 0 });
      const policy = buildSeasonalProfile({ periods: 8, monthsEach: 3, startMonth: 1, channelIds: channels, intensity: 0.8 });
      expect(policy.exposure).toBe("none");
      // Identical seasonal profile to the no-policy baseline → the policy's
      // effect contains no pilgrimage term.
      expect(policy.points.map((p) => p.civicPressure)).toEqual(baseline.points.map((p) => p.civicPressure));
    });
  }
});

describe("calibration ledger (spec §14, §15)", () => {
  it("contains real Pandharpur cases and both positive and contested/negative evidence", () => {
    expect(CALIBRATION_LEDGER.some((e) => e.id.includes("pandharpur-corridor"))).toBe(true);
    expect(CALIBRATION_LEDGER.some((e) => e.channel === "PILGRIMAGE_FACILITIES")).toBe(true);
    // Not pilgrimage-only.
    expect(CALIBRATION_LEDGER.some((e) => e.channel === "HOUSING")).toBe(true);
    expect(CALIBRATION_LEDGER.some((e) => e.channel === "LABOR_MARKET")).toBe(true);
    const summary = ledgerSummary();
    expect(summary.positive).toBeGreaterThan(0);
    expect(summary.contestedOrNegative).toBeGreaterThan(0);
    // Every entry cites evidence and states a calibration status.
    for (const e of CALIBRATION_LEDGER) {
      expect(e.evidence.sourceType).toBeTruthy();
      expect(e.calibrationStatus).toBeTruthy();
      expect(e.outcome).toMatch(/positive|negative|mixed|unclear|contested/);
    }
  });
});

describe("historical backtesting (spec §16, §17)", () => {
  it("refuses to call a backtest clean when pre- and post-policy evidence overlap", () => {
    const c = BACKTEST_CASES[0];
    const leaked = {
      ...c,
      informationAvailableBefore: {
        ...c.informationAvailableBefore,
        evidence: [...c.informationAvailableBefore.evidence, ...c.observedAfterImplementation.evidence],
      },
    };
    const check = checkNoLeakage(leaked);
    expect(check.clean).toBe(false);
    expect(check.note).toMatch(/overlap/i);
    const result = runBacktest(leaked, { direction: "decrease" });
    expect(result.leakageClean).toBe(false);
  });

  it("reports direction agreement, magnitude comparison and interval containment", () => {
    const c = BACKTEST_CASES.find((x) => x.observedMagnitude && x.observedMagnitude.value !== 0)!;
    const result = runBacktest(c, {
      direction: c.observedDirection,
      magnitude: (c.observedMagnitude!.value as number) * 1.1,
      uncertainty: { low: c.observedMagnitude!.value as number, high: (c.observedMagnitude!.value as number) * 1.5 },
    });
    expect(result.directionAgreement).toBe(true);
    expect(result.magnitudeErrorPct).toBeCloseTo(10, 5);
    expect(result.withinUncertaintyInterval).toBe(true);
    expect(result.directionOnly).toBe(false);
  });

  it("marks a direction-only comparison as such, never as a full success", () => {
    const c = BACKTEST_CASES.find((x) => !x.observedMagnitude);
    if (c) {
      const result = runBacktest(c, { direction: c.observedDirection });
      expect(result.directionOnly).toBe(true);
      expect(result.magnitudeErrorPct).toBeUndefined();
    }
  });

  it("runs the full suite with a clean leakage check", () => {
    const { results, summary } = runBacktestSuite((c) => ({ direction: c.observedDirection }));
    expect(results.length).toBe(BACKTEST_CASES.length);
    expect(summary.leakageFailures).toBe(0);
    expect(summary.clean).toBe(true);
    expect(summary.directionAgreements).toBe(results.length);
    // Direction alone must not be reported as successful prediction.
    expect(summary.note).toMatch(/not reported as successful prediction/);
  });
});
