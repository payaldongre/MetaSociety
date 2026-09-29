export const populationData = [
  { group: "0-14", male: 4200, female: 4100 },
  { group: "15-24", male: 3800, female: 3600 },
  { group: "25-34", male: 5100, female: 5300 },
  { group: "35-44", male: 4800, female: 4900 },
  { group: "45-54", male: 3900, female: 4100 },
  { group: "55-64", male: 3200, female: 3400 },
  { group: "65+", male: 2800, female: 3100 },
];

export const employmentTrend = [
  { year: "2019", employed: 89.2, unemployed: 10.8 },
  { year: "2020", employed: 82.1, unemployed: 17.9 },
  { year: "2021", employed: 85.6, unemployed: 14.4 },
  { year: "2022", employed: 87.3, unemployed: 12.7 },
  { year: "2023", employed: 88.1, unemployed: 11.9 },
  { year: "2024", employed: 89.7, unemployed: 10.3 },
  { year: "2025", employed: 90.4, unemployed: 9.6 },
];

export const incomeDistribution = [
  { bracket: "<$20k", count: 3200 },
  { bracket: "$20-40k", count: 6800 },
  { bracket: "$40-60k", count: 8400 },
  { bracket: "$60-80k", count: 5600 },
  { bracket: "$80-100k", count: 3200 },
  { bracket: ">$100k", count: 1800 },
];

export const economicSectors = [
  { sector: "Services", share: 38 },
  { sector: "Manufacturing", share: 22 },
  { sector: "Agriculture", share: 12 },
  { sector: "Tech", share: 15 },
  { sector: "Construction", share: 8 },
  { sector: "Other", share: 5 },
];

export const costOfLivingIndex = [
  { year: "2020", index: 100 },
  { year: "2021", index: 104.2 },
  { year: "2022", index: 111.5 },
  { year: "2023", index: 116.3 },
  { year: "2024", index: 119.8 },
  { year: "2025", index: 122.1 },
];

export const simulationMetrics = {
  gdp: [
    { month: "Jan", baseline: 2.1, simulated: 2.1 },
    { month: "Apr", baseline: 2.3, simulated: 2.5 },
    { month: "Jul", baseline: 2.2, simulated: 2.8 },
    { month: "Oct", baseline: 2.4, simulated: 3.1 },
    { month: "Jan+1", baseline: 2.5, simulated: 3.4 },
    { month: "Apr+1", baseline: 2.6, simulated: 3.6 },
  ],
  employment: [
    { month: "Jan", baseline: 90.4, simulated: 90.4 },
    { month: "Apr", baseline: 90.6, simulated: 91.2 },
    { month: "Jul", baseline: 90.5, simulated: 92.1 },
    { month: "Oct", baseline: 90.7, simulated: 92.8 },
    { month: "Jan+1", baseline: 90.8, simulated: 93.2 },
    { month: "Apr+1", baseline: 90.9, simulated: 93.6 },
  ],
  happiness: [
    { month: "Jan", baseline: 62, simulated: 62 },
    { month: "Apr", baseline: 63, simulated: 65 },
    { month: "Jul", baseline: 62, simulated: 68 },
    { month: "Oct", baseline: 63, simulated: 70 },
    { month: "Jan+1", baseline: 63, simulated: 72 },
    { month: "Apr+1", baseline: 64, simulated: 73 },
  ],
  inflation: [
    { month: "Jan", baseline: 3.2, simulated: 3.2 },
    { month: "Apr", baseline: 3.1, simulated: 3.4 },
    { month: "Jul", baseline: 3.0, simulated: 3.5 },
    { month: "Oct", baseline: 2.9, simulated: 3.3 },
    { month: "Jan+1", baseline: 2.8, simulated: 3.1 },
    { month: "Apr+1", baseline: 2.7, simulated: 2.9 },
  ],
};

export const alertsData = [
  { id: 1, type: "warning" as const, title: "High unemployment risk detected", description: "Youth unemployment (18-24) projected to exceed 18% by Q3 2025 without intervention.", date: "2 hours ago" },
  { id: 2, type: "danger" as const, title: "Housing shortage trend increasing", description: "Urban housing demand exceeds supply by 25%. Rental prices rising 8-15% YoY.", date: "5 hours ago" },
  { id: 3, type: "info" as const, title: "New census data available", description: "2025 mid-year population estimates released. Update your datasets for latest insights.", date: "1 day ago" },
];

export const recentSimulations = [
  { id: "sim-1", name: "Youth Employment Stimulus", date: "Mar 21, 2026", score: 78, type: "Labor Market" },
  { id: "sim-2", name: "Affordable Housing Subsidy", date: "Mar 19, 2026", score: 84, type: "Housing" },
  { id: "sim-3", name: "Small Business Tax Relief", date: "Mar 17, 2026", score: 71, type: "Tax Change" },
];

export const mockPolicySuggestions = [
  {
    name: "Targeted Skills Training Program",
    description: "Fund vocational training in high-demand sectors (tech, healthcare) for unemployed youth aged 18-30.",
    benefits: "Reduces youth unemployment by an estimated 4-6%, builds workforce pipeline for growing sectors.",
    risks: "Requires 18-24 month ramp-up. Training may not match fast-evolving job market needs.",
    affected: "Youth aged 18-30, training institutions, tech and healthcare employers.",
  },
  {
    name: "Micro-Enterprise Grant Scheme",
    description: "Provide $5,000-$15,000 seed grants to small business startups in underserved areas.",
    benefits: "Stimulates local economies, creates 2-3 jobs per grant on average, diversifies economic base.",
    risks: "Business failure rate of ~40% within 2 years. Administrative overhead for grant management.",
    affected: "Aspiring entrepreneurs, local communities, existing small businesses (competition).",
  },
  {
    name: "Flexible Work Incentive for Employers",
    description: "Tax credits for companies offering remote/hybrid work options and flexible scheduling.",
    benefits: "Improves work-life balance, reduces commuting costs and carbon emissions, attracts talent.",
    risks: "May not benefit manual/service workers. Could reduce commercial real estate demand.",
    affected: "Knowledge workers, employers, commercial landlords, public transit systems.",
  },
];
