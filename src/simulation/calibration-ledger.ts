/**
 * Calibration ledger (spec §14, §15, §19).
 *
 * A curated record of real Pandharpur-relevant interventions, what actually
 * happened, and how well the simulator's magnitude is (or is not) calibrated
 * against that outcome. It is deliberately NOT pilgrimage-only, and it is
 * deliberately not cherry-picked: positive, negative, mixed, unclear and
 * contested outcomes are all representable and all present.
 *
 * WHAT THIS IS NOT. A promise of predictive accuracy. Several entries have a
 * known DIRECTION and no evaluated MAGNITUDE; those carry
 * `calibrationStatus: "uncalibrated"` and must never be shown as precise.
 */

import { source, type CalibrationStatus, type EvidenceStrength, type SourceRecord } from "./evidence";
import type { AuthorityId } from "./governance";

export type ObservedDirection = "increase" | "decrease" | "no_change" | "unclear";

/** Spec §15: the ledger must be able to record these outcomes. */
export type LedgerOutcome = "positive" | "negative" | "mixed" | "unclear" | "contested";

export interface CalibrationEntry {
  id: string;
  policy: string;
  authority: AuthorityId | "multiple";
  /** Channel the policy corresponds to, when it maps onto one. */
  channel: string;
  /** One of the PolicyDomain values, or a free description for multi-domain. */
  domain: string;
  location: string;
  implementationPeriod: string;
  /** What actually happened, when documented. */
  observedDirection: ObservedDirection;
  /** A documented magnitude, ONLY where one exists. */
  observedMagnitude?: { value: number; unit: string; metric: string };
  metric: string;
  evidence: SourceRecord;
  evidenceStrength: EvidenceStrength;
  /** How the OUTCOME is characterised — never assume positive. */
  outcome: LedgerOutcome;
  /** Documented opposition, displacement, delay or dissatisfaction. */
  controversy?: string;
  calibrationStatus: CalibrationStatus;
  notes?: string;
}

/* --- sources ------------------------------------------------------- */

const CORRIDOR_TOI: SourceRecord = source({
  sourceType: "reliable_secondary_reporting",
  authority: "Times of India (Kolhapur)",
  title: "Pandharpur residents protest corridor development plan fearing eviction",
  date: "2026-09-09",
  url: "https://timesofindia.indiatimes.com/city/kolhapur/pandharpur-residents-protest-corridor-development-plan-fearing-eviction/articleshow/133980096.cms",
  referenceYear: 2026,
  confidence: "moderate",
  notes: "Reports ~₹3,990 crore corridor plan and resident/shop-owner protest.",
});

const CORRIDOR_HT: SourceRecord = source({
  sourceType: "reliable_secondary_reporting",
  authority: "Hindustan Times (Pune)",
  title: "Pandharpur corridor: councillors unite against land-acquisition proposal",
  date: "2026-09-10",
  url: "https://www.hindustantimes.com/cities/pune-news/pandharpur-corridor-councillors-unite-against-land-acquisition-proposal-101788979508101.html",
  referenceYear: 2026,
  confidence: "moderate",
  notes: "Tirth Kshetra Bachao Samiti protest outside Pandharpur Municipal Council.",
});

const CORRIDOR_BUDGET: SourceRecord = source({
  sourceType: "reliable_secondary_reporting",
  authority: "Sanatan Prabhat",
  title: "Budget of ₹4,000 crore approved for the Pandharpur corridor",
  date: "2026-05-05",
  url: "https://sanatanprabhat.org/english/171401.html",
  referenceYear: 2026,
  confidence: "low",
  notes: "Secondary report; crore figure quoted at ₹4,000 crore, close to the ₹3,990 crore elsewhere.",
});

const WARI_TOLL_2025: SourceRecord = source({
  sourceType: "official_notification",
  authority: "Government of Maharashtra",
  title: "Maharashtra announces toll exemption for Pandharpur pilgrimage vehicles (18 June – 10 July 2025)",
  date: "2025-06-17",
  url: "https://www.thehindu.com/news/national/maharashtra/maharashtra-announces-toll-exemption-for-pandharpur-pilgrimage-vehicles/article69704610.ece",
  measurementPeriod: "2025-06-18 to 2025-07-10",
  referenceYear: 2025,
  confidence: "high",
  notes: "Waiver applies to palkhis, MSRTC buses and warkari vehicles; over 20 lakh devotees expected.",
});

const WARI_TOLL_2026: SourceRecord = source({
  sourceType: "official_notification",
  authority: "Government of Maharashtra",
  title: "Maharashtra toll waiver for Ashadhi Wari pilgrims (6–29 July 2026)",
  date: "2026-07-07",
  url: "https://www.punekarnews.in/maharashtra-announces-toll-waiver-for-ashadhi-wari-pilgrims-from-july-6-to-29/",
  measurementPeriod: "2026-07-06 to 2026-07-29",
  referenceYear: 2026,
  confidence: "moderate",
  notes: "MSRTC buses travelling to Pandharpur exempt.",
});

const WARI_FOOTFALL: SourceRecord = source({
  sourceType: "official_statistics",
  authority: "Solapur Rural Police (reported)",
  title: "Record Ashadhi Wari footfall counted by drones; 32 lakh devotees over 3 days (2026)",
  date: "2026-07-27",
  url: "https://timesofindia.indiatimes.com/city/kolhapur/32-lakh-devotees-visited-pandharpur-during-3-day-ashadi-ekadashi-fest/articleshow/132667935.cms",
  measurementPeriod: "Ashadhi Ekadashi, July 2026",
  referenceYear: 2026,
  confidence: "moderate",
  notes: "Drone/AI-CCTV counting; ~27–28 lakh on Ekadashi day in 2025 (reported).",
});

const SHAKTIPEETH_TOI: SourceRecord = source({
  sourceType: "reliable_secondary_reporting",
  authority: "Times of India (Kolhapur)",
  title: "Farmers protest land survey for proposed Shaktipeeth Expressway in Pandharpur taluka",
  date: "2026-10-05",
  url: "https://timesofindia.indiatimes.com/city/kolhapur/shaktipeeth-protest-farmers-douse-themselves-in-petrol-climb-up-pole-force-officials-to-stop-land-survey/amp_articleshow/134716084.cms",
  referenceYear: 2026,
  confidence: "moderate",
  notes: "Land survey halted by protest at Nandore, Pandharpur taluka; state project applied locally.",
});

const PMAY_GENERAL: SourceRecord = source({
  sourceType: "programme_evaluation",
  authority: "Government of India / Ministry of Housing and Urban Affairs",
  title: "Pradhan Mantri Awas Yojana (Urban) — mission progress and evaluation",
  referenceYear: 2024,
  confidence: "low",
  notes:
    "National housing mission applied locally. Direction (more housing assistance) is well established; Pandharpur-specific evaluated magnitude is not available, so magnitude is uncalibrated.",
  unresolved: true,
});

const MGNREGA_GENERAL: SourceRecord = source({
  sourceType: "academic_research",
  authority: "Peer-reviewed development-economics literature on MGNREGA",
  title: "Employment-guarantee effects on rural wages and household consumption",
  referenceYear: 2019,
  confidence: "moderate",
  notes:
    "Academic evidence supports the direction (guaranteed employment raises rural wages/consumption); magnitudes vary widely across studies.",
  unresolved: true,
});

/* --- ledger -------------------------------------------------------- */

export const CALIBRATION_LEDGER: CalibrationEntry[] = [
  {
    id: "pandharpur-corridor-2026",
    policy: "Pandharpur pilgrimage corridor / temple precinct development plan",
    authority: "government_of_maharashtra",
    channel: "INFRASTRUCTURE",
    domain: "infrastructure",
    location: "Pandharpur (Vitthal-Rukmini temple precinct)",
    implementationPeriod: "2026 (sanction and land acquisition; project placed on temporary hold)",
    observedDirection: "unclear",
    metric: "Pilgrim infrastructure / land use",
    evidence: CORRIDOR_BUDGET,
    evidenceStrength: "moderate",
    outcome: "contested",
    controversy:
      "Residents and shop owners protested the corridor plan fearing eviction; councillors united against the land-acquisition proposal; the Tirth Kshetra Bachao Samiti marched on the Municipal Council; a proposal to transfer municipal land to the Shri Vitthal-Rukmini Mandir Samiti drew angry exchanges; the project was reported on temporary hold.",
    calibrationStatus: "uncalibrated",
    notes:
      "Included specifically so the ledger is not pilgrimage-positive-only. The documented outcome is opposition and delay, not a clean benefit. No evaluated magnitude exists.",
  },
  {
    id: "wari-toll-exemption-2025",
    policy: "Toll exemption for Wari pilgrimage vehicles to Pandharpur",
    authority: "government_of_maharashtra",
    channel: "PILGRIMAGE_FACILITIES",
    domain: "pilgrimage_facilities",
    location: "Routes to Pandharpur, Maharashtra",
    implementationPeriod: "18 June – 10 July 2025",
    observedDirection: "decrease",
    observedMagnitude: { value: 0, unit: "INR toll", metric: "Toll paid by Wari vehicles" },
    metric: "Pilgrim travel cost",
    evidence: WARI_TOLL_2025,
    evidenceStrength: "moderate",
    outcome: "positive",
    calibrationStatus: "limited",
    notes:
      "The direct effect (zero toll) is documented; the downstream welfare magnitude is not evaluated. Over 20 lakh devotees were expected in the window.",
  },
  {
    id: "wari-toll-exemption-2026",
    policy: "Toll waiver for Ashadhi Wari pilgrims (repeat of 2025)",
    authority: "government_of_maharashtra",
    channel: "PILGRIMAGE_FACILITIES",
    domain: "pilgrimage_facilities",
    location: "Routes to Pandharpur, Maharashtra",
    implementationPeriod: "6 – 29 July 2026",
    observedDirection: "decrease",
    metric: "Pilgrim travel cost",
    evidence: WARI_TOLL_2026,
    evidenceStrength: "moderate",
    outcome: "positive",
    calibrationStatus: "limited",
    notes: "Repeat of the 2025 waiver, strengthening the direction evidence.",
  },
  {
    id: "wari-footfall-2026",
    policy: "Ashadhi Wari seasonal pilgrimage (baseline pressure, not a policy)",
    authority: "multiple",
    channel: "PILGRIMAGE_FACILITIES",
    domain: "pilgrimage_facilities",
    location: "Pandharpur",
    implementationPeriod: "Ashadhi Ekadashi 2025 and 2026",
    observedDirection: "increase",
    observedMagnitude: { value: 3_200_000, unit: "devotees", metric: "3-day Ashadhi footfall (2026)" },
    metric: "Seasonal pilgrim footfall",
    evidence: WARI_FOOTFALL,
    evidenceStrength: "moderate",
    outcome: "unclear",
    calibrationStatus: "limited",
    notes:
      "This is the seasonal load the model must represent (spec §12): a temporary pressure, never permanent residents. Counts are police/drone estimates.",
  },
  {
    id: "shaktipeeth-expressway-2026",
    policy: "Maharashtra Shaktipeeth Expressway (state project applied in Pandharpur taluka)",
    authority: "government_of_maharashtra",
    channel: "INFRASTRUCTURE",
    domain: "infrastructure",
    location: "Nandore, Pandharpur taluka",
    implementationPeriod: "2026 (land survey stage)",
    observedDirection: "unclear",
    metric: "Land acquisition / infrastructure",
    evidence: SHAKTIPEETH_TOI,
    evidenceStrength: "moderate",
    outcome: "contested",
    controversy:
      "Farmers confronted officials during the proposed expressway's land survey; the survey was halted by protest. This is a state project applied locally with documented opposition.",
    calibrationStatus: "uncalibrated",
  },
  {
    id: "pmay-urban-housing",
    policy: "Pradhan Mantri Awas Yojana (Urban) applied locally",
    authority: "government_of_india",
    channel: "HOUSING",
    domain: "housing",
    location: "Pandharpur (national scheme applied locally)",
    implementationPeriod: "ongoing national mission",
    observedDirection: "decrease",
    metric: "Households under housing stress",
    evidence: PMAY_GENERAL,
    evidenceStrength: "limited",
    outcome: "mixed",
    controversy:
      "Housing-mission outcomes are widely reported as uneven across cities, with eligibility and completion issues. Direction (assistance reduces housing stress) is defensible; magnitude is not.",
    calibrationStatus: "uncalibrated",
    notes: "Non-pilgrimage example, so the ledger is not pilgrimage-only.",
  },
  {
    id: "mgnrega-employment",
    policy: "Employment-guarantee programme (MGNREGA) applied locally",
    authority: "government_of_india",
    channel: "LABOR_MARKET",
    domain: "labour_market",
    location: "Rural Solapur / Pandharpur taluka",
    implementationPeriod: "ongoing national scheme",
    observedDirection: "increase",
    metric: "Rural wage floor / household consumption",
    evidence: MGNREGA_GENERAL,
    evidenceStrength: "moderate",
    outcome: "mixed",
    controversy:
      "Academic evidence supports wage and consumption effects; implementation delays and payment arrears are widely documented, so the outcome is mixed rather than unambiguously positive.",
    calibrationStatus: "uncalibrated",
    notes: "Non-pilgrimage employment example with peer-reviewed direction evidence.",
  },
];

/* --- queries ------------------------------------------------------- */

export function ledgerByOutcome(outcome: LedgerOutcome): CalibrationEntry[] {
  return CALIBRATION_LEDGER.filter((e) => e.outcome === outcome);
}

/** Ledger entries whose magnitude is actually calibrated (limited or better). */
export function calibratedEntries(): CalibrationEntry[] {
  return CALIBRATION_LEDGER.filter((e) => e.calibrationStatus !== "uncalibrated");
}

export function ledgerSummary(): Record<LedgerOutcome, number> & { total: number; contestedOrNegative: number } {
  const counts: Record<LedgerOutcome, number> = { positive: 0, negative: 0, mixed: 0, unclear: 0, contested: 0 };
  for (const e of CALIBRATION_LEDGER) counts[e.outcome] += 1;
  return {
    ...counts,
    total: CALIBRATION_LEDGER.length,
    contestedOrNegative: counts.contested + counts.negative + counts.mixed,
  };
}
