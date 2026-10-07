/**
 * Evidence + provenance system (redesign spec §4, §5, §33, §34).
 *
 * THE POINT. Every factual number the lab displays must be traceable to a
 * source, and every modelled number must be identifiable as a model output.
 * This module is the vocabulary that makes that enforceable:
 *
 *   - `SourceRecord`   — a cited source, with a type, authority, dates and an
 *                        explicit confidence, and always a measurement period
 *                        (spec §34: never pretend two eras are one era).
 *   - `SourceType`     — not all sources are equal (spec §4 hierarchy).
 *   - `FactCategory`   — OBSERVED / HISTORICAL_OUTCOME / EMPIRICAL_RELATIONSHIP
 *                        / MODEL_INFERENCE / MODEL_ASSUMPTION / SYNTHETIC. These
 *                        must never be visually conflated (spec §5).
 *
 * Nothing here produces a number. It only labels where a number comes from.
 */

/* ------------------------------------------------------------------ */
/* Source types and hierarchy                                          */
/* ------------------------------------------------------------------ */

export const SOURCE_TYPES = [
  "official_act",
  "official_notification",
  "government_document",
  "census",
  "official_statistics",
  "programme_evaluation",
  "academic_research",
  "reliable_secondary_reporting",
  "model_assumption",
  "synthetic_population",
] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

/**
 * Preferred hierarchy (spec §4): legislation and statutory documents outrank
 * everything; model assumptions are last. Lower index = higher precedence.
 */
export const SOURCE_PRECEDENCE: Record<SourceType, number> = {
  official_act: 1,
  official_notification: 2,
  government_document: 3,
  census: 4,
  official_statistics: 5,
  programme_evaluation: 6,
  academic_research: 7,
  reliable_secondary_reporting: 8,
  model_assumption: 9,
  synthetic_population: 10,
};

/** True when a source is primary/authoritative enough to cite as fact. */
export function isAuthoritative(sourceType: SourceType): boolean {
  return SOURCE_PRECEDENCE[sourceType] <= SOURCE_PRECEDENCE.official_statistics;
}

/** The stronger (higher-precedence) of two source types. */
export function higherPrecedence(a: SourceType, b: SourceType): SourceType {
  return SOURCE_PRECEDENCE[a] <= SOURCE_PRECEDENCE[b] ? a : b;
}

/* ------------------------------------------------------------------ */
/* A cited source                                                      */
/* ------------------------------------------------------------------ */

/**
 * A cited source. `referenceYear`, `publicationDate` and `measurementPeriod`
 * are kept separate on purpose (spec §34): a 1973 Act cited in 2026 does not
 * describe 2026, and a corridor protest reported in 2026 does not describe 2011.
 *
 * `verifiedAt` is the date this entry was last checked against the source.
 * `confidence` is the curator's confidence that the entry is correctly read.
 */
export interface SourceRecord {
  sourceType: SourceType;
  /** Issuing or publishing body, e.g. "Maharashtra Legislature". */
  authority: string;
  title: string;
  /** ISO date the source was issued/published, when known. */
  date?: string;
  url?: string;
  /** Act number, gazette number, section, case number, etc. */
  documentReference?: string;
  verifiedAt: string;
  confidence: "high" | "moderate" | "low";
  notes?: string;
  /** Year the cited facts describe. */
  referenceYear?: number;
  /** ISO date of publication, when distinct from `date`. */
  publicationDate?: string;
  /** Free-text measurement window, e.g. "June 2025 Wari period". */
  measurementPeriod?: string;
  /** True when the claim could not be verified against a primary source. */
  unresolved?: boolean;
}

/** Build a source record with the required curator fields filled in. */
export function source(record: Omit<SourceRecord, "verifiedAt"> & { verifiedAt?: string }): SourceRecord {
  return { verifiedAt: record.verifiedAt ?? EVIDENCE_REVIEWED_ON, ...record };
}

/** The date the ledger and governance registry were last reviewed. */
export const EVIDENCE_REVIEWED_ON = "2026-10-07";

/* ------------------------------------------------------------------ */
/* Fact taxonomy (spec §5)                                             */
/* ------------------------------------------------------------------ */

export const FACT_CATEGORIES = [
  /** Directly supported by data. */
  "OBSERVED",
  /** Observed result of a real policy/programme. */
  "HISTORICAL_OUTCOME",
  /** Supported by research or evaluated evidence. */
  "EMPIRICAL_RELATIONSHIP",
  /** Produced by the BN/simulation from evidence-backed relationships. */
  "MODEL_INFERENCE",
  /** Chosen because sufficient empirical evidence does not exist. */
  "MODEL_ASSUMPTION",
  /** Generated at individual level from aggregate Census anchors. */
  "SYNTHETIC",
] as const;
export type FactCategory = (typeof FACT_CATEGORIES)[number];

/** Human-facing one-liners so the UI never has to invent its own wording. */
export const FACT_CATEGORY_LABELS: Record<FactCategory, string> = {
  OBSERVED: "Observed — directly supported by data",
  HISTORICAL_OUTCOME: "Historical outcome — observed result of a real policy",
  EMPIRICAL_RELATIONSHIP: "Empirical relationship — supported by research or evaluation",
  MODEL_INFERENCE: "Model inference — computed by the engine from evidence-backed relationships",
  MODEL_ASSUMPTION: "Model assumption — chosen where evidence is insufficient",
  SYNTHETIC: "Synthetic — generated per citizen from Census-anchored aggregates",
};

/** True when a category is a model output rather than a measurement. */
export function isModelled(category: FactCategory): boolean {
  return category === "MODEL_INFERENCE" || category === "MODEL_ASSUMPTION";
}

/** True when the value may be presented to a user as a measured fact. */
export function isObserved(category: FactCategory): boolean {
  return category === "OBSERVED" || category === "HISTORICAL_OUTCOME" || category === "SYNTHETIC";
}

/* ------------------------------------------------------------------ */
/* Strength + calibration (spec §19)                                   */
/* ------------------------------------------------------------------ */

/**
 * How strongly the evidence supports the DIRECTION of a relationship. This is
 * deliberately separate from magnitude calibration: an effect can have a
 * well-supported direction and an uncalibrated magnitude.
 */
export type EvidenceStrength = "high" | "moderate" | "limited" | "uncalibrated";

/**
 * How well the MAGNITUDE is calibrated against an evaluated real programme.
 * Never upgrade this to a probability: an uncalibrated magnitude is not a
 * confidence interval (spec §22).
 */
export type CalibrationStatus = "high" | "moderate" | "limited" | "uncalibrated";

/** Ordering helper: true when `a` is at least as strong as `b`. */
export function atLeast(a: EvidenceStrength, b: EvidenceStrength): boolean {
  const order: EvidenceStrength[] = ["uncalibrated", "limited", "moderate", "high"];
  return order.indexOf(a) >= order.indexOf(b);
}

/* ------------------------------------------------------------------ */
/* A labelled value                                                    */
/* ------------------------------------------------------------------ */

/** Any important number, carried together with what kind of number it is. */
export interface LabelledValue<T = number> {
  value: T;
  category: FactCategory;
  /** Present for measured/observed/historical values. */
  source?: SourceRecord;
  /** Present for model relationships: how strong the direction evidence is. */
  directionStrength?: EvidenceStrength;
  /** Present for model relationships: how well the magnitude is calibrated. */
  magnitudeCalibration?: CalibrationStatus;
  note?: string;
}

/** Render the full provenance of a labelled value for an evaluator. */
export function describeLabelledValue<T>(lv: LabelledValue<T>): {
  category: string;
  sourceType?: SourceType;
  authority?: string;
  strength?: string;
  calibration?: string;
  unresolved: boolean;
} {
  return {
    category: FACT_CATEGORY_LABELS[lv.category],
    sourceType: lv.source?.sourceType,
    authority: lv.source?.authority,
    strength: lv.directionStrength,
    calibration: lv.magnitudeCalibration,
    unresolved: Boolean(lv.source?.unresolved),
  };
}
