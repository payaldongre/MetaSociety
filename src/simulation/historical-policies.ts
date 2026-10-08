/**
 * Historical policy registry — the "grandparent" tier of GGG.
 *
 * WHAT THIS IS. A small, curated, well-provenanced set of REAL historical
 * policies/programmes, each described by the historical characteristics that
 * make it a plausible predecessor of a Pandharpur policy: its mechanism, target
 * population, context, delivery route, scale, the Bayesian-network nodes its
 * causal pathway plausibly touches, and whatever OUTCOMES are genuinely
 * documented.
 *
 * WHAT THIS IS NOT.
 *   - It is NOT an effect-size library. Where a real evaluated magnitude exists
 *     it is recorded with its source and labelled `OBSERVED` / `HISTORICAL_OUTCOME`;
 *     where it does not exist, `magnitude` is simply absent. No number here is
 *     manufactured because the simulator would find one convenient.
 *   - It is NOT an LLM judgement. Every entry is a static, reviewable record.
 *   - Selecting a historical parent never by itself changes a simulated number.
 *     GGG (ggg.ts) uses these records to ground a policy's characteristics and
 *     effect scale; the causal engine still computes every outcome.
 *
 * QUALITY OVER QUANTITY. Nine programmes, chosen because their mechanisms map
 * onto the channels the engine already models. A housing policy must not inherit
 * employment effects merely because both are government programmes — parent
 * selection is driven by mechanism and causal relevance in ggg.ts.
 */

import { source, type EvidenceStrength, type FactCategory, type SourceRecord } from "./evidence";
import type { GovernanceLevel } from "./governance";
import type { MetricKey } from "./types";

/** Spatial scale of a historical programme. Ordered local → national. */
export const HISTORICAL_SCALES = ["local", "district", "state", "national"] as const;
export type HistoricalScale = (typeof HISTORICAL_SCALES)[number];

/** Context a programme's mechanism was demonstrated in. */
export const HISTORICAL_CONTEXTS = ["rural", "urban", "mixed"] as const;
export type HistoricalContext = (typeof HISTORICAL_CONTEXTS)[number];

/** Documented direction of an observed outcome. */
export type OutcomeDirection = "increase" | "decrease" | "no_change" | "unclear";

export interface HistoricalOutcome {
  /** Plain description of what was measured. */
  metric: string;
  /**
   * The engine metric this observation is a defensible PROXY for, when one
   * exists. Deliberately optional: a toll charge or a footfall count has no
   * engine metric, and forcing one would be a category error.
   */
  engineMetric?: MetricKey;
  direction: OutcomeDirection;
  /** A documented magnitude, present ONLY when the source reports one. */
  magnitude?: { value: number; unit: string };
  /** What kind of number the direction/magnitude is. Never OBSERVED without a source. */
  category: FactCategory;
  source: SourceRecord;
  note?: string;
}

export interface HistoricalPolicy {
  id: string;
  name: string;
  authority: string;
  /** Administrative level the programme is decided at. */
  authorityLevel: GovernanceLevel;
  jurisdiction: string;
  implementationPeriod: string;

  /** Engine channel whose mechanism this programme is comparable to. */
  channel: string;
  /** One-line statement of the causal mechanism the two share. */
  mechanism: string;
  /** Fine-grained mechanism tags used by similarity scoring. */
  mechanismTags: string[];

  targetPopulation: string;
  targetTraits: string[];
  context: HistoricalContext;
  seasonality: "none" | "seasonal";
  scale: HistoricalScale;

  /** A documented programme budget, when a source reports one. */
  budget?: { value: number; unit: string; source: SourceRecord };
  /** Typical implementation duration in months, when documented. */
  durationMonths?: number;

  /** Delivery / implementation mechanism tags. */
  delivery: string[];

  /** Bayesian-network nodes this programme's causal pathway plausibly moves. */
  bnNodes: string[];

  observedOutcomes: HistoricalOutcome[];
  sideEffects: string[];

  /** How strongly the DIRECTION of the shared mechanism is supported. */
  evidenceStrength: EvidenceStrength;
  sources: SourceRecord[];
  /** Why this programme is (or is not) comparable to a Pandharpur policy. */
  comparability: string;
  /** What is uncertain about applying it here. */
  uncertainty: string;
}

/* ------------------------------------------------------------------ */
/* Cited sources                                                       */
/* ------------------------------------------------------------------ */

const MGNREGA_ACT: SourceRecord = source({
  sourceType: "official_act",
  authority: "Parliament of India",
  title: "The Mahatma Gandhi National Rural Employment Guarantee Act, 2005 (Act 42 of 2005)",
  date: "2005-09-07",
  documentReference: "Act No. 42 of 2005",
  referenceYear: 2005,
  confidence: "high",
  notes:
    "Guarantees at least 100 days of unskilled manual wage employment a year to rural households, on demand, with a statutory unemployment allowance where work is not provided.",
});

const MGNREGA_EVIDENCE: SourceRecord = source({
  sourceType: "academic_research",
  authority: "Peer-reviewed development-economics literature",
  title: "Employment-guarantee effects on rural wages and household consumption",
  referenceYear: 2019,
  confidence: "moderate",
  unresolved: true,
  notes:
    "Supports the DIRECTION (guaranteed employment raises rural wages/consumption). Estimated magnitudes vary widely across studies and states; none is adopted here.",
});

const DAYNULM_GUIDELINES: SourceRecord = source({
  sourceType: "government_document",
  authority: "Ministry of Housing and Urban Affairs, Government of India",
  title: "Deendayal Antyodaya Yojana — National Urban Livelihoods Mission (DAY-NULM): mission guidelines",
  date: "2013",
  referenceYear: 2013,
  confidence: "moderate",
  notes:
    "Urban livelihoods mission combining self-employment credit, self-help groups, skill training and shelters for the urban homeless.",
});

const SVANIDHI_GUIDELINES: SourceRecord = source({
  sourceType: "government_document",
  authority: "Ministry of Housing and Urban Affairs, Government of India",
  title: "PM Street Vendor's AtmaNirbhar Nidhi (PM SVANidhi): scheme guidelines",
  date: "2020-06-01",
  referenceYear: 2020,
  confidence: "moderate",
  notes:
    "Micro-credit facility for street vendors in urban local bodies, with interest subvention and cash-back incentives for digital transactions.",
});

const PMJAY_GUIDELINES: SourceRecord = source({
  sourceType: "government_document",
  authority: "National Health Authority, Government of India",
  title: "Ayushman Bharat Pradhan Mantri Jan Arogya Yojana (PM-JAY): scheme framework",
  date: "2018-09-23",
  referenceYear: 2018,
  confidence: "moderate",
  notes:
    "Health-assurance scheme providing hospitalisation cover to eligible low-income households, delivered through empanelled hospitals and state agencies.",
});

const PMPOSHAN_GUIDELINES: SourceRecord = source({
  sourceType: "government_document",
  authority: "Ministry of Education, Government of India",
  title: "PM POSHAN (Mid-Day Meal scheme in schools): programme framework",
  date: "2021-09-20",
  referenceYear: 2021,
  confidence: "moderate",
  notes:
    "Provides cooked meals to school children, with nutrition-support goals and a school-level delivery mechanism. Renamed from the Mid-Day Meal Scheme in 2021.",
});

const PMKISAN_GUIDELINES: SourceRecord = source({
  sourceType: "government_document",
  authority: "Ministry of Agriculture and Farmers Welfare, Government of India",
  title: "Pradhan Mantri Kisan Samman Nidhi (PM-KISAN): scheme guidelines",
  date: "2019-02-24",
  referenceYear: 2019,
  confidence: "moderate",
  notes:
    "Central-sector income-support scheme paying a direct benefit transfer to landholding farmer families, implemented through state land records and direct benefit transfer.",
});

const LADKI_BAHIN_GUIDELINES: SourceRecord = source({
  sourceType: "government_document",
  authority: "Government of Maharashtra, Women and Child Development Department",
  title: "Mukhyamantri Majhi Ladki Bahin Yojana: scheme framework",
  date: "2024-06-28",
  referenceYear: 2024,
  confidence: "moderate",
  notes:
    "State direct cash-transfer scheme for eligible women in Maharashtra, delivered through bank accounts after means-tested enrolment.",
});

const PMAY_GENERAL: SourceRecord = source({
  sourceType: "programme_evaluation",
  authority: "Government of India / Ministry of Housing and Urban Affairs",
  title: "Pradhan Mantri Awas Yojana (Urban) — mission progress and evaluation",
  referenceYear: 2024,
  confidence: "low",
  notes:
    "National housing mission applied locally. Direction (assistance eases housing stress) is defensible; Pandharpur-specific evaluated magnitude is not available.",
  unresolved: true,
});

const CORRIDOR_TOI: SourceRecord = source({
  sourceType: "reliable_secondary_reporting",
  authority: "Times of India (Kolhapur)",
  title: "Pandharpur residents protest corridor development plan fearing eviction",
  date: "2026-09-09",
  url: "https://timesofindia.indiatimes.com/city/kolhapur/pandharpur-residents-protest-corridor-development-plan-fearing-eviction/articleshow/133980096.cms",
  referenceYear: 2026,
  confidence: "moderate",
  notes: "Reports a ~₹3,990 crore corridor plan and resident/shop-owner protest.",
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
  notes: "Secondary report; the crore figure is quoted at ~₹4,000 crore, close to the ₹3,990 crore elsewhere.",
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
  notes: "Waiver applies to palkhis, MSRTC buses and warkari vehicles.",
});

const WARI_FOOTFALL: SourceRecord = source({
  sourceType: "official_statistics",
  authority: "Solapur Rural Police (reported)",
  title: "Ashadhi Wari footfall — ~32 lakh devotees over 3 days (2026)",
  date: "2026-07-27",
  url: "https://timesofindia.indiatimes.com/city/kolhapur/32-lakh-devotees-visited-pandharpur-during-3-day-ashadi-ekadashi-fest/articleshow/132667935.cms",
  measurementPeriod: "Ashadhi Ekadashi 2026",
  referenceYear: 2026,
  confidence: "moderate",
  notes: "Police/drone estimate; ~27–28 lakh on Ekadashi day in 2025.",
});

const SHAKTIPEETH_TOI: SourceRecord = source({
  sourceType: "reliable_secondary_reporting",
  authority: "Times of India (Kolhapur)",
  title: "Farmers protest land survey for proposed Shaktipeeth Expressway in Pandharpur taluka",
  date: "2026-10-05",
  url: "https://timesofindia.indiatimes.com/city/kolhapur/shaktipeeth-protest-farmers-douse-themselves-in-petrol-climb-up-pole-force-officials-to-stop-land-survey/amp_articleshow/134716084.cms",
  referenceYear: 2026,
  confidence: "moderate",
  notes: "Land survey halted by protest at Nandore, Pandharpur taluka; a state project applied locally.",
});

/* ------------------------------------------------------------------ */
/* Registry                                                            */
/* ------------------------------------------------------------------ */

export const HISTORICAL_POLICIES: HistoricalPolicy[] = [
  {
    id: "mgnrega-2005",
    name: "Mahatma Gandhi National Rural Employment Guarantee Scheme (MGNREGA)",
    authority: "Government of India",
    authorityLevel: "national",
    jurisdiction: "Rural India (applied through gram panchayats; relevant to Pandharpur taluka)",
    implementationPeriod: "2006 – present (demand-driven)",
    channel: "LABOR_MARKET",
    mechanism:
      "A statutory demand-driven guarantee of unskilled manual wage employment that raises the rural wage floor and household consumption.",
    mechanismTags: ["wage_employment", "public_works", "wage_floor", "demand_driven", "rural"],
    targetPopulation: "Rural households seeking unskilled manual work",
    targetTraits: ["rural", "unskilled", "low_income", "informal"],
    context: "rural",
    seasonality: "seasonal",
    scale: "national",
    durationMonths: undefined,
    delivery: ["gram_panchayat", "public_works", "wage_payment", "statutory_entitlement"],
    bnNodes: ["EmploymentStatus", "SectorDemand", "IncomeClass", "SectorOfWork", "WageLevelBand"],
    observedOutcomes: [
      {
        metric: "Rural wages and household consumption",
        engineMetric: "meanIncome",
        direction: "increase",
        category: "EMPIRICAL_RELATIONSHIP",
        source: MGNREGA_EVIDENCE,
        note: "Direction well supported; magnitude strongly study-dependent and not adopted.",
      },
    ],
    sideEffects: [
      "Payment arrears and implementation delays are widely documented, so the outcome is mixed rather than unambiguously positive.",
    ],
    evidenceStrength: "moderate",
    sources: [MGNREGA_ACT, MGNREGA_EVIDENCE],
    comparability:
      "Its employment-guarantee mechanism is a defensible predecessor for a local wage-employment or public-works policy. It is NOT a precedent for housing, health or infrastructure effects.",
    uncertainty:
      "A national rural scheme implemented through gram panchayats is only partly comparable to a municipal town programme.",
  },

  {
    id: "day-nulm-2013",
    name: "Deendayal Antyodaya Yojana — National Urban Livelihoods Mission (DAY-NULM)",
    authority: "Ministry of Housing and Urban Affairs, Government of India (with urban local bodies)",
    authorityLevel: "national",
    jurisdiction: "Urban local bodies across India",
    implementationPeriod: "2013 – present",
    channel: "LABOR_MARKET",
    mechanism:
      "Urban livelihoods support — self-employment credit, self-help groups, skill training and placement — that raises access to work for the urban poor.",
    mechanismTags: ["livelihood", "self_employment", "skill_training", "urban", "credit_linkage", "shg"],
    targetPopulation: "Urban poor and informal-sector workers",
    targetTraits: ["urban", "informal", "low_income", "self_employed"],
    context: "urban",
    seasonality: "none",
    scale: "national",
    delivery: ["urban_local_body", "shg_federation", "skill_training_provider", "credit_linkage"],
    bnNodes: ["EmploymentStatus", "SkillRelevance", "SectorDemand", "IncomeClass", "SpendingCapacity"],
    observedOutcomes: [
      {
        metric: "Access to urban livelihoods and skills",
        engineMetric: "employmentRatePct",
        direction: "increase",
        category: "HISTORICAL_OUTCOME",
        source: DAYNULM_GUIDELINES,
        note: "Documented as a programme objective with reported uptake; no independent evaluated magnitude adopted.",
      },
    ],
    sideEffects: [
      "Livelihood-credit uptake and training-to-placement conversion are uneven; the mission itself lists placement and repayment as challenges.",
    ],
    evidenceStrength: "limited",
    sources: [DAYNULM_GUIDELINES],
    comparability:
      "A strong mechanism match for urban employment, self-employment and skilling policies. Weak match for a pure cash transfer with no training or credit component.",
    uncertainty:
      "National-programme aggregate uptake says little about a single town's marginal effect.",
  },

  {
    id: "pm-svanidhi-2020",
    name: "PM Street Vendor's AtmaNirbhar Nidhi (PM SVANidhi)",
    authority: "Ministry of Housing and Urban Affairs, Government of India",
    authorityLevel: "national",
    jurisdiction: "Urban local bodies across India",
    implementationPeriod: "2020 – present",
    channel: "FINANCIAL_INCLUSION",
    mechanism:
      "Working-capital micro-credit to informal street vendors, with interest subvention and digital-transaction incentives, restoring informal commerce.",
    mechanismTags: ["informal_commerce", "micro_credit", "working_capital", "urban", "street_vendor"],
    targetPopulation: "Urban street vendors and informal traders",
    targetTraits: ["urban", "informal", "self_employed", "low_income"],
    context: "urban",
    seasonality: "none",
    scale: "national",
    delivery: ["urban_local_body", "bank_credit", "digital_payment", "vendor_survey"],
    bnNodes: ["IncomeClass", "SpendingCapacity", "SectorDemand"],
    observedOutcomes: [
      {
        metric: "Working capital access for street vendors",
        engineMetric: "meanIncome",
        direction: "increase",
        category: "HISTORICAL_OUTCOME",
        source: SVANIDHI_GUIDELINES,
        note: "The credit line is documented; the downstream income effect is not independently evaluated here.",
      },
    ],
    sideEffects: [
      "Informal-vendor coverage and repayment depend on local survey and banking access.",
    ],
    evidenceStrength: "limited",
    sources: [SVANIDHI_GUIDELINES],
    comparability:
      "A good mechanism match for informal-commerce and credit-access policies, including a Wari-season vendor-support policy. Not a match for wage employment or housing.",
    uncertainty:
      "Its core quantity (working capital) is not a channel the engine models directly today; the financial-inclusion channel is declared, not wired.",
  },

  {
    id: "pmay-urban",
    name: "Pradhan Mantri Awas Yojana (Urban)",
    authority: "Ministry of Housing and Urban Affairs, Government of India",
    authorityLevel: "national",
    jurisdiction: "Urban local bodies across India (national scheme applied locally)",
    implementationPeriod: "2015 – present",
    channel: "HOUSING",
    mechanism:
      "Central housing assistance — construction support and affordable-housing credit — that reduces households under housing stress.",
    mechanismTags: ["housing_assistance", "construction", "affordability", "urban", "subsidy"],
    targetPopulation: "Eligible urban households",
    targetTraits: ["urban", "low_income", "housing_stress"],
    context: "urban",
    seasonality: "none",
    scale: "national",
    delivery: ["urban_local_body", "housing_credit", "construction_subsidy"],
    bnNodes: ["HousingQuality", "HouseholdStress", "IncomeClass", "PublicSentiment"],
    observedOutcomes: [
      {
        metric: "Households under housing stress",
        engineMetric: "happinessIndex",
        direction: "decrease",
        category: "HISTORICAL_OUTCOME",
        source: PMAY_GENERAL,
        note: "Reduction in housing stress is the mission's objective; the engine's faithful proxy is wellbeing, which rises when stress falls. Evaluation is uneven across cities.",
      },
    ],
    sideEffects: [
      "Eligibility disputes, completion delays and uneven city-level outcomes are documented.",
    ],
    evidenceStrength: "limited",
    sources: [PMAY_GENERAL],
    comparability:
      "A genuine mechanism match for housing interventions. It must NOT be used to justify employment or income effects for a housing policy.",
    uncertainty: "Pandharpur-specific evaluated magnitude is unavailable, so magnitude is uncalibrated.",
  },

  {
    id: "pmjay-2018",
    name: "Ayushman Bharat Pradhan Mantri Jan Arogya Yojana (PM-JAY)",
    authority: "National Health Authority, Government of India (with states)",
    authorityLevel: "national",
    jurisdiction: "States and union territories across India",
    implementationPeriod: "2018 – present",
    channel: "HEALTHCARE_ACCESS",
    mechanism:
      "Publicly funded health assurance that expands insurance coverage and reduces out-of-pocket hospitalisation cost for low-income households.",
    mechanismTags: ["health_coverage", "insurance", "out_of_pocket", "hospital", "financial_protection"],
    targetPopulation: "Eligible low-income households",
    targetTraits: ["low_income", "informal", "rural", "urban"],
    context: "mixed",
    seasonality: "none",
    scale: "national",
    delivery: ["state_health_agency", "empanelled_hospital", "coverage_eligibility"],
    bnNodes: ["HealthInsurance", "HealthBurden", "SpendingCapacity", "HouseholdStress"],
    observedOutcomes: [
      {
        metric: "Hospitalisation coverage and out-of-pocket burden",
        engineMetric: "happinessIndex",
        direction: "decrease",
        category: "HISTORICAL_OUTCOME",
        source: PMJAY_GUIDELINES,
        note: "Coverage expansion is documented; the reduction in out-of-pocket burden is the scheme's stated mechanism.",
      },
    ],
    sideEffects: [
      "Hospital empanelment, claim settlement and awareness vary across districts.",
    ],
    evidenceStrength: "limited",
    sources: [PMJAY_GUIDELINES],
    comparability:
      "A direct mechanism match for health-coverage policies. It carries no employment or housing effect.",
    uncertainty: "The engine's health channel is modelled; no evaluated Pandharpur magnitude exists.",
  },

  {
    id: "pm-poshan-2021",
    name: "PM POSHAN (Mid-Day Meal scheme in schools)",
    authority: "Ministry of Education, Government of India (with states)",
    authorityLevel: "national",
    jurisdiction: "Government and aided schools across India",
    implementationPeriod: "1995 – present (renamed PM POSHAN, 2021)",
    channel: "EDUCATION_SKILL",
    mechanism:
      "In-school meal delivery that supports child nutrition and school participation, a foundational human-capital input.",
    mechanismTags: ["nutrition", "schooling", "human_capital", "children", "in_kind_transfer"],
    targetPopulation: "School children",
    targetTraits: ["children", "school_going", "low_income", "rural", "urban"],
    context: "mixed",
    seasonality: "seasonal",
    scale: "national",
    delivery: ["school", "cooked_meal", "state_department"],
    bnNodes: ["EducationLevel", "SkillRelevance"],
    observedOutcomes: [
      {
        metric: "School participation and nutrition support",
        engineMetric: "happinessIndex",
        direction: "increase",
        category: "HISTORICAL_OUTCOME",
        source: PMPOSHAN_GUIDELINES,
        note: "Programme objective; no independent evaluated magnitude for a single town is adopted.",
      },
    ],
    sideEffects: ["Delivery quality and leakage are widely discussed; effects are mixed in practice."],
    evidenceStrength: "limited",
    sources: [PMPOSHAN_GUIDELINES],
    comparability:
      "A mechanism match for education and human-capital policies. It is an in-kind child-nutrition programme, so it is a weak predecessor for adult skilling.",
    uncertainty: "The engine's education channel has a long lag; the magnitude is uncalibrated.",
  },

  {
    id: "pandharpur-corridor-2026",
    name: "Pandharpur pilgrimage corridor / temple-precinct development plan",
    authority: "Government of Maharashtra (with the Pandharpur Municipal Council and the district administration)",
    authorityLevel: "state",
    jurisdiction: "Pandharpur (Vitthal-Rukmini temple precinct)",
    implementationPeriod: "2026 (sanction and land acquisition; project placed on temporary hold)",
    channel: "INFRASTRUCTURE",
    mechanism:
      "Large-scale pilgrimage-infrastructure development and land assembly around the temple precinct.",
    mechanismTags: ["infrastructure", "land_acquisition", "pilgrimage", "urban_renewal", "construction"],
    targetPopulation: "Pilgrims and residents in the precinct",
    targetTraits: ["urban", "pilgrimage", "traders", "residents"],
    context: "urban",
    seasonality: "seasonal",
    scale: "state",
    budget: { value: 3_990 * 1e7, unit: "INR", source: CORRIDOR_TOI },
    delivery: ["state_agency", "land_acquisition", "capital_works", "contractor"],
    bnNodes: ["SectorDemand", "EmploymentStatus", "PublicSentiment", "ProtestRiskBand"],
    observedOutcomes: [
      {
        metric: "Pilgrim infrastructure / land use",
        direction: "unclear",
        category: "HISTORICAL_OUTCOME",
        source: CORRIDOR_BUDGET,
        note: "The documented near-term outcome is opposition and delay, not a clean benefit.",
      },
    ],
    sideEffects: [
      "Resident and shop-owner protest against eviction risk; councillors united against the land-acquisition proposal; the project was reported on temporary hold.",
    ],
    evidenceStrength: "moderate",
    sources: [CORRIDOR_TOI, CORRIDOR_HT, CORRIDOR_BUDGET],
    comparability:
      "The closest real Pandharpur predecessor for pilgrimage-infrastructure policy — and specifically included because its documented outcome is CONTESTED, not positive.",
    uncertainty:
      "A state-scale capital project with contested land acquisition; its political side effects may dominate any infrastructure benefit.",
  },

  {
    id: "shaktipeeth-expressway-2026",
    name: "Maharashtra Shaktipeeth Expressway (state project applied in Pandharpur taluka)",
    authority: "Government of Maharashtra",
    authorityLevel: "state",
    jurisdiction: "Pandharpur taluka (survey halted at Nandore)",
    implementationPeriod: "2026 (land survey stage)",
    channel: "INFRASTRUCTURE",
    mechanism: "State road-infrastructure development requiring land acquisition through the district administration.",
    mechanismTags: ["infrastructure", "roads", "land_acquisition", "state_project"],
    targetPopulation: "Agricultural landholders and road users",
    targetTraits: ["rural", "landholders", "farmers"],
    context: "rural",
    seasonality: "none",
    scale: "state",
    delivery: ["state_agency", "land_acquisition", "capital_works"],
    bnNodes: ["SectorDemand", "EmploymentStatus", "PublicSentiment", "ProtestRiskBand"],
    observedOutcomes: [
      {
        metric: "Land acquisition / infrastructure",
        direction: "unclear",
        category: "HISTORICAL_OUTCOME",
        source: SHAKTIPEETH_TOI,
        note: "Land survey halted by farmer protest; no benefit realised.",
      },
    ],
    sideEffects: ["Farmer protest halted the land survey; documented conflict over land."],
    evidenceStrength: "moderate",
    sources: [SHAKTIPEETH_TOI],
    comparability:
      "A rural-infrastructure predecessor with a documented contested process. It should temper, not inflate, an optimistic infrastructure estimate.",
    uncertainty: "Survey-stage only; no outcome has been observed yet.",
  },

  {
    id: "wari-toll-exemption",
    name: "Toll exemption for Wari pilgrimage vehicles to Pandharpur",
    authority: "Government of Maharashtra",
    authorityLevel: "state",
    jurisdiction: "Routes to Pandharpur, Maharashtra",
    implementationPeriod: "18 June – 10 July 2025 (repeated 6 – 29 July 2026)",
    channel: "PILGRIMAGE_FACILITIES",
    mechanism:
      "Seasonal relief of a direct travel cost for Wari pilgrims, easing pilgrimage access during the Ashadhi window.",
    mechanismTags: ["pilgrimage", "travel_cost", "seasonal", "access", "in_kind_relief"],
    targetPopulation: "Wari pilgrims (palkhis, MSRTC buses, warkari vehicles)",
    targetTraits: ["pilgrimage", "temporary_visitors", "seasonal"],
    context: "mixed",
    seasonality: "seasonal",
    scale: "state",
    durationMonths: 1,
    delivery: ["state_notification", "toll_waiver"],
    bnNodes: ["PilgrimFootfall", "LocalInfraQuality"],
    observedOutcomes: [
      {
        metric: "Toll paid by Wari vehicles",
        direction: "decrease",
        magnitude: { value: 0, unit: "INR" },
        category: "OBSERVED",
        source: WARI_TOLL_2025,
        note: "The direct effect (zero toll in the window) is documented; downstream welfare is not evaluated.",
      },
      {
        metric: "Ashadhi-season pilgrim footfall",
        engineMetric: "happinessIndex",
        direction: "increase",
        magnitude: { value: 3_200_000, unit: "devotees over three days" },
        category: "OBSERVED",
        source: WARI_FOOTFALL,
        note: "Seasonal baseline load (~32 lakh over 3 days, 2026). This is a seasonal pressure, never permanent residents.",
      },
    ],
    sideEffects: ["The relief is seasonal and repeat-issued; it does not create durable local capacity by itself."],
    evidenceStrength: "moderate",
    sources: [WARI_TOLL_2025, WARI_FOOTFALL],
    comparability:
      "The direct Wari predecessor for pilgrimage-facility policy. It establishes the seasonal mechanism and the exposure, not an income or employment effect.",
    uncertainty:
      "The engine models seasonal civic pressure relative to off-season, not year-over-year footfall growth; the toll channel itself is not an engine metric.",
  },
  {
    id: "pm-kisan-2019",
    name: "Pradhan Mantri Kisan Samman Nidhi (PM-KISAN)",
    authority: "Ministry of Agriculture and Farmers Welfare, Government of India",
    authorityLevel: "national",
    jurisdiction: "Landholding farmer families across India",
    implementationPeriod: "2019 – present",
    channel: "INCOME_SUPPORT",
    mechanism:
      "Direct, unconditional income support paid to landholding farmer families, changing disposable income without a delivery or training component.",
    mechanismTags: ["cash_transfer", "income_support", "demand_injection", "rural", "unconditional"],
    targetPopulation: "Landholding farmer families",
    targetTraits: ["rural", "low_income", "farmers"],
    context: "rural",
    seasonality: "none",
    scale: "national",
    delivery: ["direct_benefit_transfer", "bank_account", "land_record"],
    bnNodes: ["IncomeClass", "SpendingCapacity", "SectorDemand"],
    observedOutcomes: [
      {
        metric: "Household income support received",
        engineMetric: "meanIncome",
        direction: "increase",
        category: "HISTORICAL_OUTCOME",
        source: PMKISAN_GUIDELINES,
        note: "The transfer itself is documented; the downstream household effect is not independently evaluated here.",
      },
    ],
    sideEffects: [
      "Eligibility depends on land records; exclusion errors are documented.",
    ],
    evidenceStrength: "limited",
    sources: [PMKISAN_GUIDELINES],
    comparability:
      "A genuine income-support predecessor: an unconditional transfer with a documented transfer mechanism. It carries no employment or training effect.",
    uncertainty:
      "A national transfer says nothing about the marginal local effect of an additional small transfer.",
  },

  {
    id: "ladki-bahin-2024",
    name: "Mukhyamantri Majhi Ladki Bahin Yojana (Maharashtra)",
    authority: "Government of Maharashtra",
    authorityLevel: "state",
    jurisdiction: "Maharashtra (state scheme applied locally)",
    implementationPeriod: "2024 – present",
    channel: "INCOME_SUPPORT",
    mechanism:
      "State direct cash transfer to eligible women, changing disposable household income through a state delivery system.",
    mechanismTags: ["cash_transfer", "income_support", "demand_injection", "women", "state_scheme"],
    targetPopulation: "Eligible women in Maharashtra households",
    targetTraits: ["urban", "rural", "low_income", "women"],
    context: "mixed",
    seasonality: "none",
    scale: "state",
    delivery: ["direct_benefit_transfer", "bank_account", "aadhaar"],
    bnNodes: ["IncomeClass", "SpendingCapacity", "SectorDemand"],
    observedOutcomes: [
      {
        metric: "Household income support received",
        engineMetric: "meanIncome",
        direction: "increase",
        category: "HISTORICAL_OUTCOME",
        source: LADKI_BAHIN_GUIDELINES,
        note: "A state cash-transfer scheme; no independent evaluated Pandharpur magnitude is adopted.",
      },
    ],
    sideEffects: ["Means-tested eligibility; enrolment and exclusion are administrative constraints."],
    evidenceStrength: "limited",
    sources: [LADKI_BAHIN_GUIDELINES],
    comparability:
      "A close precedessor for a municipal income-support policy: same state, same delivery machinery, same mechanism.",
    uncertainty: "The engine's income-support channel is a modelled demand-injection; magnitude is uncalibrated.",
  },
];

/** Look up one historical policy by id. */
export function historicalPolicyById(id: string): HistoricalPolicy | undefined {
  return HISTORICAL_POLICIES.find((p) => p.id === id);
}

/** All historical policies comparable to a set of engine channels. */
export function historicalPoliciesForChannels(channelIds: string[]): HistoricalPolicy[] {
  const set = new Set(channelIds);
  return HISTORICAL_POLICIES.filter((p) => set.has(p.channel));
}

export const HISTORICAL_REGISTRY_REVIEWED_ON = "2026-10-08";
