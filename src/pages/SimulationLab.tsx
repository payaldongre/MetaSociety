/**
 * Simulation Lab.
 *
 * Every number on this page comes from the decisive simulation engine in
 * `@/simulation`: a Census-anchored population of one agent per real citizen,
 * a multi-period roll of a Bayesian network over that population, and
 * (optionally) a Differential Evolution search over the policy vector.
 *
 * No language model produces an outcome, a magnitude or a chart series here.
 * The decision layer may answer TYPED questions (Choose / Score / Noul) at
 * period boundaries, but it is never the source of a displayed number.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import {
  AlertTriangle,
  BadgeCheck,
  CheckCircle2,
  Cpu,
  Database,
  Download,
  FlaskConical,
  Info,
  Layers,
  MapPin,
  Network,
  Play,
  Save,
  ShieldCheck,
  TrendingDown,
  TrendingUp,
  XCircle,
} from "lucide-react";
import {
  BN_VERSION,
  CENSUS,
  FIELD_LEDGER,
  GENERATOR_VERSION,
  LOWER_IS_BETTER,
  METRIC_KEYS,
  METRIC_LABELS,
  METRIC_UNITS,
  REFERENCE_BUDGET,
  SCENARIO_PRESETS,
  TOWN_DISTRICT,
  TOWN_NAME,
  createDecisionEngine,
  getPopulation,
  populationComposition,
  runSimulation,
  type MetricKey,
  type PolicyVector,
  type PolicyType,
  type ProvenanceTag,
  type SimulationResult,
  type Zone,
} from "@/simulation";
import { saveRun } from "@/lib/runStore";

/* ------------------------------------------------------------------ */
/* Formatting                                                          */
/* ------------------------------------------------------------------ */

const ZONE_LABELS: Record<Zone, string> = {
  east: "East",
  west: "West",
  north: "North",
  south: "South",
};

const POLICY_TYPES: { value: PolicyType; label: string }[] = [
  { value: "subsidy", label: "Subsidy / transfer" },
  { value: "tax", label: "Tax change" },
  { value: "labor", label: "Labour market programme" },
  { value: "housing", label: "Housing programme" },
  { value: "education", label: "Education / skills" },
  { value: "regulation", label: "Regulation" },
];

const PROVENANCE_STYLES: Record<ProvenanceTag, string> = {
  census2011: "bg-success/12 text-success border-success/30",
  estimated: "bg-warning/12 text-warning border-warning/30",
  modelled: "bg-primary/12 text-primary border-primary/30",
  assumed: "bg-muted text-muted-foreground border-border",
};

/**
 * Metrics each instrument's documented channels target (SPEC §5.1). Read off
 * the network's policy shifts: these are the metrics the policy is *meant* to
 * move, so a movement elsewhere is a spillover and a movement nowhere is
 * reported as such.
 */
const POLICY_DIRECT_TARGETS: Record<PolicyType, MetricKey[]> = {
  none: [],
  subsidy: ["employmentRatePct", "meanIncome", "wageIndex", "happinessIndex"],
  labor: ["employmentRatePct", "meanIncome", "wageIndex"],
  housing: ["happinessIndex", "gini", "meanIncome"],
  education: ["gdpGrowthPct", "employmentRatePct", "wageIndex"],
  tax: ["inflationPct", "gini"],
  regulation: ["protestRisk", "inflationPct"],
};

/**
 * Specific, named limitations — shown permanently, not buried in a README
 * (SPEC §5.1). The point is that an evaluator can trust the rest of the model
 * more, not less, for seeing exactly where its edges are.
 */
const MODEL_LIMITATIONS: string[] = [
  "Income and sector are modelled, not Census-measured. Only population, sex split, households, children 0–6, literacy and worker counts are verified Census 2011 figures — see the provenance ledger in the Data tab.",
  "No external economic shocks are modelled: no recession, no new national policy, no commodity-price movement.",
  "One town only (Pandharpur, Solapur). There is no migration between towns and no spillover from neighbouring economies.",
  "Response directions are checked on every run; magnitudes are not yet calibrated. Anchoring income and sector to NSSO or District Census Handbook tables is what would make the sizes claimable.",
  "The ward-to-zone mapping is population-balanced contiguous ranges — an assumption, not sourced ward geography.",
  "This is a counterfactual comparison tool, not a forecasting service. It carries no claim of predictive accuracy.",
  "It is not a peer-reviewed model. Unlike the scenario explorer that inspired its presentation, there are no external reviewers and no national survey of assumptions.",
  "Zone figures are reported after the run as a partition of surviving agents, so migration outflow reduces the reported zone population.",
];

/**
 * A run's configuration is captured as a signature. Results are stale when the
 * current inputs no longer match the signature captured at run time.
 * Exported so it can be unit-tested without driving the whole page.
 */
export function isResultsStale(ranSignature: string | null, currentSignature: string): boolean {
  return ranSignature !== null && ranSignature !== currentSignature;
}

function fmtMetric(key: MetricKey, value: number): string {
  const unit = METRIC_UNITS[key];
  if (unit === "₹") {
    if (Math.abs(value) >= 100000) return `₹${(value / 100000).toFixed(2)}L`;
    return `₹${Math.round(value).toLocaleString("en-IN")}`;
  }
  if (key === "gini") return value.toFixed(3);
  if (unit === "%") return `${value.toFixed(1)}%`;
  return value.toFixed(1);
}

function fmtDelta(key: MetricKey, value: number): string {
  if (Math.abs(value) < 1e-9) return "no change";
  const unit = METRIC_UNITS[key];
  if (unit === "₹") {
    const sign = value > 0 ? "+" : "−";
    return `${sign}${fmtMetric(key, Math.abs(value))}`;
  }
  const sign = value > 0 ? "+" : "−";
  return `${sign}${fmtMetric(key, Math.abs(value))}`;
}

/** Is a movement in this metric an improvement? */
function isBetter(key: MetricKey, delta: number): boolean {
  return LOWER_IS_BETTER.includes(key) ? delta < 0 : delta > 0;
}

function deltaTone(key: MetricKey, delta: number): string {
  if (Math.abs(delta) < 1e-9) return "text-muted-foreground";
  return isBetter(key, delta) ? "text-success" : "text-destructive";
}

const fmtInrCrore = (v: number) => `₹${(v / 1e7).toFixed(2)} cr`;
const fmtInt = (v: number) => Math.round(v).toLocaleString("en-IN");

/* ------------------------------------------------------------------ */
/* Small presentational pieces                                         */
/* ------------------------------------------------------------------ */

function StatCard({
  metricKey,
  value,
  baseline,
  interval,
}: {
  metricKey: MetricKey;
  value: number;
  baseline: number;
  interval: { p05: number; p50: number; p95: number };
}) {
  const delta = value - baseline;
  const Icon = Math.abs(delta) < 1e-9 ? Info : isBetter(metricKey, delta) ? TrendingUp : TrendingDown;
  return (
    <div className="rounded-lg border bg-card p-3">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{METRIC_LABELS[metricKey]}</p>
      <div className="mt-1 flex items-baseline gap-1.5">
        <span className="text-lg font-semibold text-card-foreground">{fmtMetric(metricKey, value)}</span>
        <Icon className={`h-3.5 w-3.5 ${deltaTone(metricKey, delta)}`} />
      </div>
      <p className={`text-xs font-medium ${deltaTone(metricKey, delta)}`}>{fmtDelta(metricKey, delta)} vs no-policy</p>
      <p className="mt-0.5 text-[11px] text-muted-foreground">
        Random-seed range {fmtMetric(metricKey, interval.p05)} – {fmtMetric(metricKey, interval.p95)}
      </p>
    </div>
  );
}

function ValidationRow({
  check,
  passed,
  observed,
  expected,
}: {
  check: string;
  passed: boolean;
  observed: string;
  expected: string;
}) {
  return (
    <div className="flex items-start gap-2 border-b border-border/60 py-1.5 last:border-0">
      {passed ? (
        <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />
      ) : (
        <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
      )}
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium text-card-foreground">{check}</p>
        <p className="text-[11px] text-muted-foreground">
          {observed} · expected {expected}
        </p>
      </div>
    </div>
  );
}

/**
 * The permanent model-limitations panel (SPEC §5.1). Always rendered, never
 * gated behind a run, and never written by a language model.
 */
function ModelLimitations() {
  return (
    <Card className="animate-fade-up border-warning/30">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <AlertTriangle className="h-4 w-4 text-warning" />
          Model limitations
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          A structured, inspectable model calibrated against Census-anchored data for one pilot town — read it as a
          disciplined comparison tool, not as a forecast.
        </p>
      </CardHeader>
      <CardContent className="space-y-1.5">
        {MODEL_LIMITATIONS.map((limitation) => (
          <p key={limitation} className="text-xs text-muted-foreground">
            • {limitation}
          </p>
        ))}
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

export default function SimulationLab() {
  /* --- configuration --- */
  const [policyType, setPolicyType] = useState<PolicyType>("subsidy");
  const [policyName, setPolicyName] = useState("Pilgrimage-corridor employment subsidy");
  const [intensityPct, setIntensityPct] = useState([65]);
  const [budgetCrore, setBudgetCrore] = useState([12]);
  const [durationMonths, setDurationMonths] = useState([24]);
  const [alloc, setAlloc] = useState<[number[], number[], number[]]>([[30], [40], [30]]);
  const [scenarioKey, setScenarioKey] = useState("substantial");
  const [optimize, setOptimize] = useState(false);
  const [engineKind, setEngineKind] = useState<"rule" | "jev" | "llm">("rule");
  const [seed, setSeed] = useState("20260101");

  /* --- run state --- */
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ phase: string; fraction: number; detail?: string } | null>(null);
  const [result, setResult] = useState<SimulationResult | null>(null);
  const [ranSignature, setRanSignature] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [activeMetric, setActiveMetric] = useState<MetricKey>("gdpGrowthPct");
  const [saving, setSaving] = useState(false);
  const runToken = useRef(0);
  const lastPolicyRef = useRef<PolicyVector | null>(null);

  /* --- population summary (loaded after first paint: 98,923 agents) --- */
  const [population, setPopulation] = useState<{
    size: number;
    households: number;
    manifest: string;
    byZone: number[];
    byIncomeClass: number[];
  } | null>(null);

  useEffect(() => {
    const id = window.setTimeout(() => {
      const pop = getPopulation();
      const composition = populationComposition(pop);
      setPopulation({
        size: pop.size,
        households: pop.households,
        manifest: pop.manifest,
        byZone: Array.from(composition.byZone),
        byIncomeClass: Array.from(composition.byIncomeClass),
      });
    }, 0);
    return () => window.clearTimeout(id);
  }, []);

  const ledger = useMemo(() => {
    const counts: Record<ProvenanceTag, number> = { census2011: 0, estimated: 0, modelled: 0, assumed: 0 };
    for (const entry of FIELD_LEDGER) counts[entry.tag] += 1;
    return counts;
  }, []);

  // A signature of every input that changes the result. Compared against the
  // signature captured when the last run completed, so the UI can warn when the
  // displayed numbers belong to a previous configuration.
  const configSignature = useMemo(
    () =>
      JSON.stringify({
        policyType,
        policyName,
        intensityPct,
        budgetCrore,
        durationMonths,
        alloc,
        scenarioKey,
        optimize,
        engineKind,
        seed,
      }),
    [alloc, budgetCrore, durationMonths, engineKind, intensityPct, optimize, policyName, policyType, scenarioKey, seed],
  );

  // Allocation shares are normalised to sum to 1 before the run; show the
  // effective share so a 15/15/20 slider split is not read as an unallocated 50%.
  const allocTotal = alloc[0][0] + alloc[1][0] + alloc[2][0] || 1;
  const resultsStale = isResultsStale(ranSignature, configSignature);

  const run = useCallback(async () => {
    const token = runToken.current + 1;
    runToken.current = token;
    setRunning(true);
    setFailure(null);
    setProgress({ phase: "Preparing the agent population", fraction: 0.01 });

    const parsedSeed = Number.parseInt(seed, 10);
    const scenario = SCENARIO_PRESETS[scenarioKey]?.levers ?? SCENARIO_PRESETS.substantial.levers;

    // Remote adapters are optional. Without a configured endpoint the engine
    // falls back to the deterministic rule table and says so in its stats.
    //
    // The endpoint must be a server-side proxy, never a direct provider URL with
    // a bundled key: anything read from import.meta.env is compiled into the
    // client bundle and shipped to every visitor. The proxy holds the provider
    // secret and injects it; the browser only ever sees the proxy URL.
    const remoteEndpoint = (import.meta.env.VITE_DECISION_ENDPOINT as string | undefined) ?? undefined;
    const decisionEngine = createDecisionEngine(engineKind, remoteEndpoint ? { endpoint: remoteEndpoint } : {});

    // Let the spinner paint before the (synchronous, CPU-bound) engine starts.
    await new Promise((resolve) => window.setTimeout(resolve, 30));

    try {
      const allocTotal = alloc[0][0] + alloc[1][0] + alloc[2][0] || 1;
      const policy: PolicyVector = {
        type: policyType,
        name: policyName.trim() || "Untitled policy",
        intensity: intensityPct[0] / 100,
        budget: budgetCrore[0] * 1e7,
        durationMonths: durationMonths[0],
        allocation: {
          housing: alloc[0][0] / allocTotal,
          education: alloc[1][0] / allocTotal,
          employment: alloc[2][0] / allocTotal,
        },
      };
      lastPolicyRef.current = policy;
      const res = await runSimulation(
        {
          townId: "pandharpur_in_mh",
          policy,
          scenario,
          mode: optimize ? "optimize" : "single",
          seed: Number.isFinite(parsedSeed) ? parsedSeed : 20260101,
          bnVersion: BN_VERSION,
          zoneFilter: "all",
        },
        {
          decisionEngine,
          onProgress: (p) => {
            if (runToken.current === token) setProgress(p);
          },
        },
      );
      if (runToken.current !== token) return;
      setResult(res);
      setRanSignature(configSignature);
      toast.success(
        optimize ? "Simulation and policy search complete" : "Simulation complete",
        { description: `${fmtInt(res.populationSize)} agents · ${res.periods} periods · seed ${res.seed}` },
      );
    } catch (error) {
      if (runToken.current !== token) return;
      const message = error instanceof Error ? error.message : String(error);
      setFailure(message);
      toast.error("Simulation failed", { description: message });
    } finally {
      if (runToken.current === token) {
        setRunning(false);
        setProgress(null);
      }
    }
  }, [
    alloc,
    budgetCrore,
    configSignature,
    durationMonths,
    engineKind,
    intensityPct,
    optimize,
    policyName,
    policyType,
    scenarioKey,
    seed,
  ]);

  const downloadResult = useCallback(() => {
    if (!result) return;
    const blob = new Blob([JSON.stringify(result, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${result.runId}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [result]);

  const saveCurrentRun = useCallback(async () => {
    if (!result || !lastPolicyRef.current) return;
    setSaving(true);
    try {
      const outcome = await saveRun(result, lastPolicyRef.current);
      if (outcome.remoteError) {
        toast.warning("Saved locally", { description: `Supabase sync failed: ${outcome.remoteError}` });
      } else if (outcome.storage === "local+supabase") {
        toast.success("Run saved and synced");
      } else {
        toast.success("Run saved locally", {
          description: "Visible in Saved Reports. Connect Supabase to sync across devices.",
        });
      }
    } finally {
      setSaving(false);
    }
  }, [result]);

  /**
   * Where the policy lands, read off the run itself (SPEC §5.1).
   *
   * `direct` are the metrics the instrument's own channels target; `spillover`
   * are metrics that moved without being targeted (e.g. inflation responding to
   * a subsidy); `unaffected` moved by nothing measurable. `emergent` is not
   * invented here — it is the engine's own warnings about second-order effects.
   */
  const channelBreakdown = useMemo(() => {
    if (!result) return null;
    const direct = POLICY_DIRECT_TARGETS[policyType] ?? [];
    const groups = {
      direct: [] as { key: MetricKey; delta: number }[],
      spillover: [] as { key: MetricKey; delta: number }[],
      unaffected: [] as MetricKey[],
    };
    for (const key of METRIC_KEYS) {
      const delta = result.point[key] - result.baseline[key];
      const material = Math.abs(delta) > Math.max(1e-9, Math.abs(result.baseline[key]) * 1e-6);
      if (!material) groups.unaffected.push(key);
      else if (direct.includes(key)) groups.direct.push({ key, delta });
      else groups.spillover.push({ key, delta });
    }
    return { ...groups, emergent: result.warnings };
  }, [result, policyType]);

  const failedChecks = result ? result.validation.filter((v) => !v.passed) : [];

  const trajectory = useMemo(() => {
    if (!result) return [];
    return result.trajectories[activeMetric] ?? [];
  }, [result, activeMetric]);

  return (
    <div className="space-y-6">
      {/* ---------------- header ---------------- */}
      <div className="animate-fade-up">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-bold text-foreground">Policy Simulation Lab</h1>
          <Badge variant="outline" className="border-primary/40 bg-primary/10 text-primary">
            <Cpu className="mr-1 h-3 w-3" /> Decisive engine · no generated numbers
          </Badge>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          {TOWN_NAME} ({TOWN_DISTRICT}) — one agent per real citizen, rolled period by period through a Bayesian
          network. The no-policy baseline comes from this same engine, so every result ships with its own comparison.
        </p>
        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <Database className="h-3.5 w-3.5" />
            {population ? `${fmtInt(population.size)} agents · ${fmtInt(population.households)} households` : "loading population…"}
          </span>
          <span className="flex items-center gap-1.5">
            <Network className="h-3.5 w-3.5" /> BN {BN_VERSION} · generator {GENERATOR_VERSION}
          </span>
          {population && (
            <span className="flex items-center gap-1.5">
              <Layers className="h-3.5 w-3.5" /> manifest {population.manifest.slice(0, 12)}
            </span>
          )}
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[340px_1fr]">
        {/* ---------------- configuration ---------------- */}
        <Card className="animate-fade-up stagger-1 h-fit xl:sticky xl:top-4">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <FlaskConical className="h-4 w-4 text-primary" />
              Policy configuration
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-xs">Policy name</Label>
              <Input
                className="h-9"
                value={policyName}
                onChange={(e) => setPolicyName(e.target.value)}
                placeholder="e.g. Pilgrimage-corridor employment subsidy"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Instrument</Label>
              <Select value={policyType} onValueChange={(v) => setPolicyType(v as PolicyType)}>
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {POLICY_TYPES.map((p) => (
                    <SelectItem key={p.value} value={p.value}>
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs">Intensity</Label>
                <span className="text-xs font-medium text-card-foreground">{intensityPct[0]}%</span>
              </div>
              <Slider value={intensityPct} onValueChange={setIntensityPct} min={5} max={100} step={5} />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs">Budget</Label>
                <span className="text-xs font-medium text-card-foreground">
                  {fmtInrCrore(budgetCrore[0] * 1e7)}
                </span>
              </div>
              <Slider value={budgetCrore} onValueChange={setBudgetCrore} min={1} max={20} step={0.5} />
              <p className="text-[11px] text-muted-foreground">
                Reference budget for banding {fmtInrCrore(REFERENCE_BUDGET)}
              </p>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs">Duration</Label>
                <span className="text-xs font-medium text-card-foreground">{durationMonths[0]} months</span>
              </div>
              <Slider value={durationMonths} onValueChange={setDurationMonths} min={3} max={60} step={3} />
              <p className="text-[11px] text-muted-foreground">
                {Math.max(1, Math.round(durationMonths[0] / 3))} simulated periods, 3 months each
              </p>
            </div>

            <div className="space-y-2 rounded-md border bg-muted/30 p-3">
              <p className="text-xs font-medium text-card-foreground">Allocation</p>
              {(
                [
                  ["Housing", 0],
                  ["Education", 1],
                  ["Employment", 2],
                ] as const
              ).map(([label, index]) => (
                <div key={label} className="space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-muted-foreground">{label}</span>
                    <span className="text-[11px] font-medium text-card-foreground">
                      {alloc[index][0]}% <span className="text-muted-foreground">→ {((alloc[index][0] / allocTotal) * 100).toFixed(0)}% of budget</span>
                    </span>
                  </div>
                  <Slider
                    value={alloc[index]}
                    onValueChange={(v) =>
                      setAlloc((prev) => {
                        const next: [number[], number[], number[]] = [[...prev[0]], [...prev[1]], [...prev[2]]];
                        next[index] = v;
                        return next;
                      })
                    }
                    min={5}
                    max={90}
                    step={5}
                  />
                </div>
              ))}
              <p className="text-[11px] leading-snug text-muted-foreground">
                The three shares are normalised to sum to 100% before the run, so the whole budget is always split
                across these channels — there is no unallocated remainder. A 15 / 15 / 20 split becomes 30% / 30% /
                40% of the budget.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">AI economic scenario</Label>
              <Select value={scenarioKey} onValueChange={setScenarioKey}>
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(SCENARIO_PRESETS).map(([key, preset]) => (
                    <SelectItem key={key} value={key}>
                      {preset.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[11px] leading-snug text-muted-foreground">
                {SCENARIO_PRESETS[scenarioKey]?.description}
              </p>
            </div>

            <Separator />

            <div className="flex items-center justify-between gap-3">
              <div>
                <Label className="text-xs">Search the policy space</Label>
                <p className="text-[11px] text-muted-foreground">
                  Differential Evolution over intensity, budget, duration and allocation, scored by the network.
                </p>
              </div>
              <Switch checked={optimize} onCheckedChange={setOptimize} />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Decision layer</Label>
              <Select value={engineKind} onValueChange={(v) => setEngineKind(v as "rule" | "jev" | "llm")}>
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="rule">Rule table (offline, default)</SelectItem>
                  <SelectItem value="jev">Jev — typed System One model</SelectItem>
                  <SelectItem value="llm">Schema-constrained LLM</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-[11px] leading-snug text-muted-foreground">
                The decision layer answers typed questions at period boundaries. Without a configured endpoint it
                degrades to the rule table and records that it did — it never supplies a displayed number.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Seed</Label>
              <Input className="h-9" value={seed} onChange={(e) => setSeed(e.target.value)} inputMode="numeric" />
              <p className="text-[11px] text-muted-foreground">
                Same seed, same inputs → byte-identical result.
              </p>
            </div>

            <Button className="w-full" onClick={run} disabled={running}>
              {running ? (
                <>
                  <span className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-primary-foreground border-t-transparent" />
                  Running…
                </>
              ) : (
                <>
                  <Play className="mr-1.5 h-4 w-4" />
                  Run simulation
                </>
              )}
            </Button>
          </CardContent>
        </Card>

        {/* ---------------- results ---------------- */}
        <div className="space-y-4">
          {running && progress && (
            <Card className="animate-fade-in">
              <CardContent className="space-y-3 pt-6">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium text-card-foreground">{progress.phase}</span>
                  <span className="text-muted-foreground">{Math.round(progress.fraction * 100)}%</span>
                </div>
                <Progress value={progress.fraction * 100} />
                {progress.detail && <p className="text-xs text-muted-foreground">{progress.detail}</p>}
              </CardContent>
            </Card>
          )}

          {failure && !running && (
            <Card className="border-destructive/40">
              <CardContent className="flex items-start gap-3 pt-6">
                <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
                <div>
                  <p className="text-sm font-medium text-card-foreground">The run did not complete</p>
                  <p className="mt-1 text-xs text-muted-foreground">{failure}</p>
                </div>
              </CardContent>
            </Card>
          )}

          {!result && !running && !failure && (
            <Card>
              <CardContent className="flex flex-col items-center justify-center px-6 py-16 text-center">
                <FlaskConical className="mb-4 h-14 w-14 text-muted-foreground/25" />
                <p className="max-w-md text-sm text-muted-foreground">
                  Configure an instrument and run it. The engine simulates every citizen agent across each period,
                  rolls the town layer back into the population, and reports outcomes with a random-seed variation
                  range, zone incidence and its own accounting checks.
                </p>
              </CardContent>
            </Card>
          )}

          {result && !running && (
            <>
              {resultsStale && (
                <Card className="animate-fade-up border-warning/40 bg-warning/5">
                  <CardContent className="flex items-start gap-3 pt-6">
                    <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-warning" />
                    <div>
                      <p className="text-sm font-medium text-card-foreground">
                        The configuration changed since this run
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        These results were produced by the previous configuration — run {"{result.runId}"} · seed{" "}
                        {result.seed} · {result.periods} periods. They do not reflect your current settings. Press run
                        again to update them.
                      </p>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* ---------------- headline ---------------- */}
              <div className="animate-fade-up grid grid-cols-2 gap-3 lg:grid-cols-3">
                {METRIC_KEYS.map((key) => (
                  <StatCard
                    key={key}
                    metricKey={key}
                    value={result.point[key]}
                    baseline={result.baseline[key]}
                    interval={result.intervals[key]}
                  />
                ))}
              </div>

              <Tabs defaultValue="impact" className="animate-fade-up stagger-1">
                <TabsList className="flex-wrap">
                  <TabsTrigger value="impact">Impact</TabsTrigger>
                  <TabsTrigger value="zones">Zones</TabsTrigger>
                  {optimize && <TabsTrigger value="search">Search</TabsTrigger>}
                  <TabsTrigger value="evidence">Evidence</TabsTrigger>
                  <TabsTrigger value="data">Data &amp; provenance</TabsTrigger>
                </TabsList>

                {/* ---------------- impact ---------------- */}
                <TabsContent value="impact" className="space-y-4">
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-base">Trajectory · {METRIC_LABELS[activeMetric]}</CardTitle>
                      <p className="text-xs text-muted-foreground">
                        No-policy baseline and simulated path over {result.periods} periods. The range on each card is
                        the 5th–95th percentile across random seeds at the final period — variation from Monte-Carlo
                        sampling only, not from model assumptions. The headline is the seed you chose, so it can sit at
                        either end of that range rather than the middle.
                      </p>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <div className="flex flex-wrap gap-1.5">
                        {METRIC_KEYS.map((key) => (
                          <Button
                            key={key}
                            size="sm"
                            variant={key === activeMetric ? "default" : "outline"}
                            className="h-7 px-2 text-[11px]"
                            onClick={() => setActiveMetric(key)}
                          >
                            {METRIC_LABELS[key]}
                          </Button>
                        ))}
                      </div>
                      <ResponsiveContainer width="100%" height={260}>
                        <LineChart data={trajectory}>
                          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                          <XAxis dataKey="month" tick={{ fontSize: 10 }} unit="m" />
                          <YAxis tick={{ fontSize: 10 }} domain={["auto", "auto"]} />
                          <Tooltip
                            contentStyle={{
                              background: "hsl(var(--card))",
                              border: "1px solid hsl(var(--border))",
                              fontSize: 12,
                            }}
                          />
                          <Legend wrapperStyle={{ fontSize: 11 }} />
                          <Line
                            type="monotone"
                            dataKey="baseline"
                            name="No policy"
                            stroke="hsl(var(--muted-foreground))"
                            strokeWidth={1.5}
                            strokeDasharray="4 4"
                            dot={false}
                          />
                          <Line
                            type="monotone"
                            dataKey="simulated"
                            name="Simulated"
                            stroke="hsl(var(--primary))"
                            strokeWidth={2}
                            dot={{ r: 2 }}
                          />
                        </LineChart>
                      </ResponsiveContainer>
                    </CardContent>
                  </Card>

                  <div className="grid gap-4 lg:grid-cols-2">
                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-base">Channel ramp and outlay</CardTitle>
                        <p className="text-xs text-muted-foreground">
                          Intensity actually applied each period after the documented channel lag, and cumulative spend.
                        </p>
                      </CardHeader>
                      <CardContent>
                        <ResponsiveContainer width="100%" height={220}>
                          <AreaChart data={result.trajectoryTrace}>
                            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                            <XAxis dataKey="month" tick={{ fontSize: 10 }} unit="m" />
                            <YAxis yAxisId="left" tick={{ fontSize: 10 }} />
                            <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10 }} width={70} />
                            <Tooltip
                              contentStyle={{
                                background: "hsl(var(--card))",
                                border: "1px solid hsl(var(--border))",
                                fontSize: 12,
                              }}
                            />
                            <Legend wrapperStyle={{ fontSize: 11 }} />
                            <Area
                              yAxisId="left"
                              type="monotone"
                              dataKey="appliedIntensity"
                              name="Applied intensity (0–1)"
                              stroke="hsl(var(--primary))"
                              fill="hsl(var(--primary) / 0.18)"
                            />
                            <Area
                              yAxisId="right"
                              type="monotone"
                              dataKey="cumulativeSpend"
                              name="Cumulative spend (₹)"
                              stroke="hsl(var(--warning))"
                              fill="hsl(var(--warning) / 0.14)"
                            />
                          </AreaChart>
                        </ResponsiveContainer>
                      </CardContent>
                    </Card>

                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-base">Which factor drove the result</CardTitle>
                        <p className="text-xs text-muted-foreground">
                          Expected shift in the outcome distribution when each upstream node is fixed — the network's own
                          explanation, not a generated narrative.
                        </p>
                      </CardHeader>
                      <CardContent>
                        <ResponsiveContainer width="100%" height={220}>
                          <BarChart
                            data={result.causalAttribution.slice(0, 8).map((f) => ({
                              node: f.node,
                              influence: Number(f.influence.toFixed(4)),
                            }))}
                            layout="vertical"
                            margin={{ left: 8, right: 16 }}
                          >
                            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
                            <XAxis type="number" tick={{ fontSize: 10 }} />
                            <YAxis type="category" dataKey="node" tick={{ fontSize: 10 }} width={110} />
                            <Tooltip
                              contentStyle={{
                                background: "hsl(var(--card))",
                                border: "1px solid hsl(var(--border))",
                                fontSize: 12,
                              }}
                            />
                            <Bar dataKey="influence" name="Influence" fill="hsl(var(--primary))" radius={[0, 3, 3, 0]} />
                          </BarChart>
                        </ResponsiveContainer>
                      </CardContent>
                    </Card>
                  </div>

                  {channelBreakdown && (
                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-base">Where this policy lands</CardTitle>
                        <p className="text-xs text-muted-foreground">
                          Read off this run rather than asserted: the instrument's declared targets, the spillovers that
                          moved without being targeted, and the second-order effects the engine flagged. A negative
                          result is shown as plainly as a positive one.
                        </p>
                      </CardHeader>
                      <CardContent className="grid gap-4 sm:grid-cols-3">
                        <div>
                          <p className="mb-1.5 text-xs font-medium text-primary">Directly affected</p>
                          {channelBreakdown.direct.length === 0 ? (
                            <p className="text-[11px] text-muted-foreground">None measurable on this run.</p>
                          ) : (
                            channelBreakdown.direct.map(({ key, delta }) => (
                              <div key={key} className="flex items-center justify-between py-0.5 text-[11px]">
                                <span className="text-muted-foreground">{METRIC_LABELS[key]}</span>
                                <span className={deltaTone(key, delta)}>{fmtDelta(key, delta)}</span>
                              </div>
                            ))
                          )}
                        </div>
                        <div>
                          <p className="mb-1.5 text-xs font-medium text-warning">Spillover</p>
                          {channelBreakdown.spillover.length === 0 ? (
                            <p className="text-[11px] text-muted-foreground">No untargeted metric moved.</p>
                          ) : (
                            channelBreakdown.spillover.map(({ key, delta }) => (
                              <div key={key} className="flex items-center justify-between py-0.5 text-[11px]">
                                <span className="text-muted-foreground">{METRIC_LABELS[key]}</span>
                                <span className={deltaTone(key, delta)}>{fmtDelta(key, delta)}</span>
                              </div>
                            ))
                          )}
                        </div>
                        <div>
                          <p className="mb-1.5 text-xs font-medium text-muted-foreground">Unaffected</p>
                          {channelBreakdown.unaffected.length === 0 ? (
                            <p className="text-[11px] text-muted-foreground">Every metric moved.</p>
                          ) : (
                            channelBreakdown.unaffected.map((key) => (
                              <p key={key} className="py-0.5 text-[11px] text-muted-foreground">
                                {METRIC_LABELS[key]}
                              </p>
                            ))
                          )}
                        </div>
                        {channelBreakdown.emergent.length > 0 && (
                          <div className="sm:col-span-3">
                            <p className="mb-1.5 text-xs font-medium text-destructive">Newly emergent (second-order)</p>
                            {channelBreakdown.emergent.map((warning, i) => (
                              <p key={i} className="text-[11px] text-muted-foreground">
                                • {warning}
                              </p>
                            ))}
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  )}

                  <div className="grid gap-4 lg:grid-cols-2">
                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-base">Household income distribution</CardTitle>
                        <p className="text-xs text-muted-foreground">Before and after the simulated policy.</p>
                      </CardHeader>
                      <CardContent>
                        <ResponsiveContainer width="100%" height={220}>
                          <BarChart
                            data={result.distributions.incomeBefore.map((bucket, i) => ({
                              bucket: bucket.bucket,
                              before: bucket.count,
                              after: result.distributions.incomeAfter[i]?.count ?? 0,
                            }))}
                          >
                            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                            <XAxis dataKey="bucket" tick={{ fontSize: 9 }} interval={0} angle={-25} textAnchor="end" height={50} />
                            <YAxis tick={{ fontSize: 10 }} tickFormatter={(v: number) => fmtInt(v)} />
                            <Tooltip
                              contentStyle={{
                                background: "hsl(var(--card))",
                                border: "1px solid hsl(var(--border))",
                                fontSize: 12,
                              }}
                            />
                            <Legend wrapperStyle={{ fontSize: 11 }} />
                            <Bar dataKey="before" name="Before" fill="hsl(var(--muted-foreground) / 0.5)" radius={[3, 3, 0, 0]} />
                            <Bar dataKey="after" name="After" fill="hsl(var(--primary))" radius={[3, 3, 0, 0]} />
                          </BarChart>
                        </ResponsiveContainer>
                      </CardContent>
                    </Card>

                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-base">Sentiment shift</CardTitle>
                        <p className="text-xs text-muted-foreground">
                          Agent sentiment states before and after the run.
                        </p>
                      </CardHeader>
                      <CardContent>
                        <ResponsiveContainer width="100%" height={220}>
                          <BarChart
                            data={result.distributions.sentimentBefore.map((s, i) => ({
                              label: s.label,
                              before: s.count,
                              after: result.distributions.sentimentAfter[i]?.count ?? 0,
                            }))}
                          >
                            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                            <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                            <YAxis tick={{ fontSize: 10 }} tickFormatter={(v: number) => fmtInt(v)} />
                            <Tooltip
                              contentStyle={{
                                background: "hsl(var(--card))",
                                border: "1px solid hsl(var(--border))",
                                fontSize: 12,
                              }}
                            />
                            <Legend wrapperStyle={{ fontSize: 11 }} />
                            <Bar dataKey="before" name="Before" fill="hsl(var(--muted-foreground) / 0.5)" radius={[3, 3, 0, 0]} />
                            <Bar dataKey="after" name="After" fill="hsl(var(--success))" radius={[3, 3, 0, 0]} />
                          </BarChart>
                        </ResponsiveContainer>
                      </CardContent>
                    </Card>
                  </div>

                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="flex items-center gap-2 text-base">
                        <AlertTriangle className="h-4 w-4 text-warning" />
                        Risk alerts raised by this run
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2">
                      {result.alerts.length === 0 && (
                        <p className="text-xs text-muted-foreground">
                          No threshold breach was triggered on this trajectory.
                        </p>
                      )}
                      {result.alerts.map((alert, i) => (
                        <div key={`${alert.month}-${i}`} className="flex items-start gap-2 rounded-md border bg-muted/20 p-2.5">
                          <Badge
                            variant="outline"
                            className={
                              alert.severity === "danger"
                                ? "border-destructive/40 bg-destructive/10 text-destructive"
                                : alert.severity === "warning"
                                  ? "border-warning/40 bg-warning/10 text-warning"
                                  : "border-border bg-muted text-muted-foreground"
                            }
                          >
                            {alert.severity}
                          </Badge>
                          <div className="min-w-0">
                            <p className="text-xs text-card-foreground">{alert.message}</p>
                            <p className="text-[11px] text-muted-foreground">
                              month {alert.month} · {METRIC_LABELS[alert.metric]}
                            </p>
                          </div>
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                </TabsContent>

                {/* ---------------- zones ---------------- */}
                <TabsContent value="zones" className="space-y-4">
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="flex items-center gap-2 text-base">
                        <MapPin className="h-4 w-4 text-primary" />
                        Zone incidence — where the policy actually lands
                      </CardTitle>
                      <p className="text-xs text-muted-foreground">
                        The agent is a person in a household in a ward in a zone: the citizen either feels this policy or
                        does not. Zones are a partition of all {CENSUS.wards} wards, reported after the run, never
                        simulated as four entities.
                      </p>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <ResponsiveContainer width="100%" height={240}>
                        <BarChart
                          data={(["east", "west", "north", "south"] as Zone[]).map((zone) => ({
                            zone: ZONE_LABELS[zone],
                            gdp: Number((result.byZone[zone].metrics.gdpGrowthPct.p50 - result.point.gdpGrowthPct).toFixed(2)),
                            employment: Number(
                              (result.byZone[zone].metrics.employmentRatePct.p50 - result.point.employmentRatePct).toFixed(2),
                            ),
                            population: result.byZone[zone].population,
                          }))}
                        >
                          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                          <XAxis dataKey="zone" tick={{ fontSize: 11 }} />
                          <YAxis tick={{ fontSize: 10 }} />
                          <Tooltip
                            contentStyle={{
                              background: "hsl(var(--card))",
                              border: "1px solid hsl(var(--border))",
                              fontSize: 12,
                            }}
                          />
                          <Legend wrapperStyle={{ fontSize: 11 }} />
                          <ReferenceLine y={0} stroke="hsl(var(--border))" />
                          <Bar dataKey="gdp" name="GDP growth, pp vs town-wide" radius={[3, 3, 0, 0]}>
                            {(["east", "west", "north", "south"] as Zone[]).map((zone) => (
                              <Cell
                                key={zone}
                                fill={
                                  result.byZone[zone].metrics.gdpGrowthPct.p50 >= result.point.gdpGrowthPct
                                    ? "hsl(var(--success))"
                                    : "hsl(var(--destructive))"
                                }
                              />
                            ))}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>

                      <div className="overflow-x-auto">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead className="text-xs">Zone</TableHead>
                              <TableHead className="text-xs">Population</TableHead>
                              <TableHead className="text-xs">GDP growth</TableHead>
                              <TableHead className="text-xs">Employment</TableHead>
                              <TableHead className="text-xs">Happiness</TableHead>
                              <TableHead className="text-xs">Inflation</TableHead>
                              <TableHead className="text-xs">Protest risk</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {(["east", "west", "north", "south"] as Zone[]).map((zone) => {
                              const m = result.byZone[zone].metrics;
                              const dGdp = m.gdpGrowthPct.p50 - result.point.gdpGrowthPct;
                              return (
                                <TableRow key={zone}>
                                  <TableCell className="text-xs font-medium">{ZONE_LABELS[zone]}</TableCell>
                                  <TableCell className="text-xs text-muted-foreground">
                                    {fmtInt(result.byZone[zone].population)}
                                  </TableCell>
                                  <TableCell className={`text-xs font-medium ${deltaTone("gdpGrowthPct", dGdp)}`}>
                                    {fmtMetric("gdpGrowthPct", m.gdpGrowthPct.p50)}{" "}
                                    <span className="font-normal">({fmtDelta("gdpGrowthPct", dGdp)})</span>
                                  </TableCell>
                                  <TableCell className="text-xs">
                                    {fmtMetric("employmentRatePct", m.employmentRatePct.p50)}
                                    <span className="ml-1 text-muted-foreground">
                                      {fmtMetric("employmentRatePct", m.employmentRatePct.p05)}–
                                      {fmtMetric("employmentRatePct", m.employmentRatePct.p95)}
                                    </span>
                                  </TableCell>
                                  <TableCell className="text-xs">{fmtMetric("happinessIndex", m.happinessIndex.p50)}</TableCell>
                                  <TableCell className="text-xs">{fmtMetric("inflationPct", m.inflationPct.p50)}</TableCell>
                                  <TableCell className="text-xs">{fmtMetric("protestRisk", m.protestRisk.p50)}</TableCell>
                                </TableRow>
                              );
                            })}
                            <TableRow className="bg-muted/40">
                              <TableCell className="text-xs font-semibold">Town-wide</TableCell>
                              <TableCell className="text-xs text-muted-foreground">
                                {fmtInt(result.populationSize)}
                              </TableCell>
                              <TableCell className="text-xs font-semibold">
                                {fmtMetric("gdpGrowthPct", result.point.gdpGrowthPct)}
                              </TableCell>
                              <TableCell className="text-xs font-semibold">
                                {fmtMetric("employmentRatePct", result.point.employmentRatePct)}
                              </TableCell>
                              <TableCell className="text-xs font-semibold">
                                {fmtMetric("happinessIndex", result.point.happinessIndex)}
                              </TableCell>
                              <TableCell className="text-xs font-semibold">
                                {fmtMetric("inflationPct", result.point.inflationPct)}
                              </TableCell>
                              <TableCell className="text-xs font-semibold">
                                {fmtMetric("protestRisk", result.point.protestRisk)}
                              </TableCell>
                            </TableRow>
                          </TableBody>
                        </Table>
                      </div>
                    </CardContent>
                  </Card>
                </TabsContent>

                {/* ---------------- search ---------------- */}
                {optimize && (
                  <TabsContent value="search" className="space-y-4">
                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-base">Differential Evolution convergence</CardTitle>
                        <p className="text-xs text-muted-foreground">
                          The search runs on a reduced agent sample with coarser periods — the only approximation in the
                          system, and it is labelled. The reported trajectory above is still the vector you configured;
                          this tab shows what the search found around it.
                        </p>
                      </CardHeader>
                      <CardContent>
                        {result.convergence.length === 0 ? (
                          <p className="text-xs text-muted-foreground">No search was run for this result.</p>
                        ) : (
                          <ResponsiveContainer width="100%" height={240}>
                            <LineChart data={result.convergence}>
                              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                              <XAxis dataKey="generation" tick={{ fontSize: 10 }} />
                              <YAxis tick={{ fontSize: 10 }} domain={["auto", "auto"]} />
                              <Tooltip
                                contentStyle={{
                                  background: "hsl(var(--card))",
                                  border: "1px solid hsl(var(--border))",
                                  fontSize: 12,
                                }}
                              />
                              <Legend wrapperStyle={{ fontSize: 11 }} />
                              <Line type="monotone" dataKey="best" name="Best scalar score" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
                              <Line type="monotone" dataKey="mean" name="Population mean" stroke="hsl(var(--muted-foreground))" strokeWidth={1.5} strokeDasharray="4 4" dot={false} />
                              <Line type="monotone" dataKey="spread" name="Spread" stroke="hsl(var(--warning))" strokeWidth={1.5} dot={false} />
                            </LineChart>
                          </ResponsiveContainer>
                        )}
                      </CardContent>
                    </Card>

                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-base">Non-dominated candidates</CardTitle>
                        <p className="text-xs text-muted-foreground">
                          The Pareto front, so a conflict between goals is shown as a trade-off rather than averaged away.
                        </p>
                      </CardHeader>
                      <CardContent className="overflow-x-auto">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead className="text-xs">Intensity</TableHead>
                              <TableHead className="text-xs">Budget</TableHead>
                              <TableHead className="text-xs">Duration</TableHead>
                              <TableHead className="text-xs">Housing</TableHead>
                              <TableHead className="text-xs">Education</TableHead>
                              <TableHead className="text-xs">Employment</TableHead>
                              <TableHead className="text-xs">Score</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {result.paretoFront.map((c, i) => {
                              const values = Object.values(c.objectives);
                              return (
                                <TableRow key={i}>
                                  <TableCell className="text-xs">{(c.params.intensity * 100).toFixed(0)}%</TableCell>
                                  <TableCell className="text-xs">{fmtInrCrore(c.params.budget)}</TableCell>
                                  <TableCell className="text-xs">{c.params.durationMonths} mo</TableCell>
                                  <TableCell className="text-xs">{(c.params.allocation.housing * 100).toFixed(0)}%</TableCell>
                                  <TableCell className="text-xs">{(c.params.allocation.education * 100).toFixed(0)}%</TableCell>
                                  <TableCell className="text-xs">{(c.params.allocation.employment * 100).toFixed(0)}%</TableCell>
                                  <TableCell className="text-xs font-medium">
                                    {values.length ? (values.reduce((a, b) => a + b, 0) / values.length).toFixed(3) : "—"}
                                  </TableCell>
                                </TableRow>
                              );
                            })}
                            {result.paretoFront.length === 0 && (
                              <TableRow>
                                <TableCell colSpan={7} className="text-xs text-muted-foreground">
                                  The search produced no non-dominated candidate.
                                </TableCell>
                              </TableRow>
                            )}
                          </TableBody>
                        </Table>
                      </CardContent>
                    </Card>
                  </TabsContent>
                )}

                {/* ---------------- evidence ---------------- */}
                <TabsContent value="evidence" className="space-y-4">
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="flex items-center gap-2 text-base">
                        <ShieldCheck className="h-4 w-4 text-success" />
                        Evidence pack · {result.validation.length - failedChecks.length}/{result.validation.length} checks passed
                      </CardTitle>
                      <p className="text-xs text-muted-foreground">
                        Every run re-checks the Census totals, the network's documented directions, the accounting
                        identities and reproducibility, and reports what it found.
                      </p>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      {failedChecks.length > 0 && (
                        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3">
                          <p className="text-xs font-medium text-destructive">
                            {failedChecks.length} check(s) failed on this run
                          </p>
                          <p className="mt-1 text-[11px] text-muted-foreground">
                            A failed identity means the run is not internally consistent and its numbers should not be
                            used. A failed direction check means the network moved against its documented sign.
                          </p>
                        </div>
                      )}
                      {(["population", "network", "aggregation", "optimization", "reproducibility", "decisions"] as const).map(
                        (group) => {
                          const checks = result.validation.filter((v) => v.group === group);
                          if (checks.length === 0) return null;
                          const passedCount = checks.filter((c) => c.passed).length;
                          return (
                            <div key={group}>
                              <div className="mb-1.5 flex items-center gap-2">
                                <Badge variant="outline" className="capitalize">
                                  {group}
                                </Badge>
                                <span className="text-[11px] text-muted-foreground">
                                  {passedCount}/{checks.length} passed
                                </span>
                              </div>
                              {checks.map((c, i) => (
                                <ValidationRow
                                  key={`${group}-${i}`}
                                  check={c.check}
                                  passed={c.passed}
                                  observed={c.observed}
                                  expected={c.expected}
                                />
                              ))}
                            </div>
                          );
                        },
                      )}
                    </CardContent>
                  </Card>

                  <div className="grid gap-4 lg:grid-cols-2">
                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-base">Guardrails</CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-2">
                        {result.guardrails.map((g, i) => (
                          <div key={i} className="flex items-start gap-2 rounded-md border bg-muted/20 p-2.5">
                            {g.passed ? (
                              <BadgeCheck className="mt-0.5 h-4 w-4 shrink-0 text-success" />
                            ) : (
                              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
                            )}
                            <div className="min-w-0">
                              <p className="text-xs font-medium text-card-foreground">{g.check}</p>
                              {g.note && <p className="text-[11px] text-muted-foreground">{g.note}</p>}
                            </div>
                          </div>
                        ))}
                        {result.guardrails.length === 0 && (
                          <p className="text-xs text-muted-foreground">No guardrail was evaluated on this run.</p>
                        )}
                      </CardContent>
                    </Card>

                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-base">Decision layer statistics</CardTitle>
                        <p className="text-xs text-muted-foreground">
                          Typed decisions made at period boundaries, with the escalation rate below the automation
                          threshold — the cases a human would be asked to review.
                        </p>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        <div className="grid grid-cols-2 gap-3">
                          <div className="rounded-md border p-3">
                            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Engine</p>
                            <p className="text-sm font-medium text-card-foreground">{result.decisionStats.engine}</p>
                          </div>
                          <div className="rounded-md border p-3">
                            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Calls</p>
                            <p className="text-sm font-medium text-card-foreground">{fmtInt(result.decisionStats.calls)}</p>
                          </div>
                          <div className="rounded-md border p-3">
                            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Mean confidence</p>
                            <p className="text-sm font-medium text-card-foreground">
                              {(result.decisionStats.meanConfidence * 100).toFixed(1)}%
                            </p>
                          </div>
                          <div className="rounded-md border p-3">
                            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Escalation rate</p>
                            <p className="text-sm font-medium text-card-foreground">
                              {(result.decisionStats.escalationRate * 100).toFixed(1)}%
                            </p>
                          </div>
                        </div>
                        {result.decisionStats.fallbackUsed && (
                          <p className="text-[11px] text-warning">
                            The selected decision engine was unavailable and this run fell back to the deterministic rule
                            table. Reported rather than hidden.
                          </p>
                        )}
                        <p className="text-[11px] text-muted-foreground">
                          Engine versions — Bayesian network {result.engine.bn}
                          {result.engine.de ? `, search ${result.engine.de}` : ""}, decision layer {result.engine.decision}.
                        </p>
                      </CardContent>
                    </Card>
                  </div>

                  {result.warnings.length > 0 && (
                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="flex items-center gap-2 text-base">
                          <Info className="h-4 w-4 text-warning" />
                          Run notes
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-1.5">
                        {result.warnings.map((w, i) => (
                          <p key={i} className="text-xs text-muted-foreground">
                            • {w}
                          </p>
                        ))}
                      </CardContent>
                    </Card>
                  )}
                </TabsContent>

                {/* ---------------- data ---------------- */}
                <TabsContent value="data" className="space-y-4">
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="flex items-center gap-2 text-base">
                        <Database className="h-4 w-4 text-primary" />
                        Population provenance
                      </CardTitle>
                      <p className="text-xs text-muted-foreground">
                        What is verified against the Census and what is modelled, stated field by field. This ledger is
                        generated from the field tags, so it cannot drift from the generator.
                      </p>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="flex flex-wrap gap-2">
                        {(["census2011", "estimated", "modelled", "assumed"] as ProvenanceTag[]).map((tag) => (
                          <Badge key={tag} variant="outline" className={PROVENANCE_STYLES[tag]}>
                            {tag} · {ledger[tag]}
                          </Badge>
                        ))}
                      </div>

                      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                        <div className="rounded-md border p-3">
                          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Census population</p>
                          <p className="text-sm font-medium text-card-foreground">{fmtInt(CENSUS.totalPopulation)}</p>
                        </div>
                        <div className="rounded-md border p-3">
                          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Agents generated</p>
                          <p className="text-sm font-medium text-card-foreground">{fmtInt(result.populationSize)}</p>
                        </div>
                        <div className="rounded-md border p-3">
                          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Households</p>
                          <p className="text-sm font-medium text-card-foreground">{fmtInt(CENSUS.households)}</p>
                        </div>
                        <div className="rounded-md border p-3">
                          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Wards</p>
                          <p className="text-sm font-medium text-card-foreground">{CENSUS.wards}</p>
                        </div>
                      </div>

                      {population && (
                        <div className="grid gap-3 sm:grid-cols-2">
                          <div className="rounded-md border p-3">
                            <p className="mb-2 text-xs font-medium text-card-foreground">Agents per zone</p>
                            {(["east", "west", "north", "south"] as Zone[]).map((zone, i) => (
                              <div key={zone} className="flex items-center justify-between py-0.5 text-[11px]">
                                <span className="text-muted-foreground">{ZONE_LABELS[zone]}</span>
                                <span className="text-card-foreground">
                                  {fmtInt(population.byZone[i])} ·{" "}
                                  {((population.byZone[i] / population.size) * 100).toFixed(1)}%
                                </span>
                              </div>
                            ))}
                          </div>
                          <div className="rounded-md border p-3">
                            <p className="mb-2 text-xs font-medium text-card-foreground">Population manifests</p>
                            <p className="text-[11px] break-all text-muted-foreground">
                              run {result.populationManifest.slice(0, 16)}…
                              <br />
                              generator {GENERATOR_VERSION} · seed {result.seed}
                            </p>
                            <p className="mt-2 text-[11px] text-muted-foreground">
                              The manifest hashes the generation inputs, so a result can always be traced back to the
                              exact population that produced it.
                            </p>
                          </div>
                        </div>
                      )}

                      <ScrollArea className="h-72 rounded-md border">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead className="text-xs">Field</TableHead>
                              <TableHead className="text-xs">Basis</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {FIELD_LEDGER.map((entry) => (
                              <TableRow key={entry.field}>
                                <TableCell className="align-top">
                                  <span className="block text-xs font-medium text-card-foreground">{entry.field}</span>
                                  <Badge variant="outline" className={`mt-1 ${PROVENANCE_STYLES[entry.tag]}`}>
                                    {entry.tag}
                                  </Badge>
                                </TableCell>
                                <TableCell className="text-xs text-muted-foreground">{entry.basis}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </ScrollArea>
                    </CardContent>
                  </Card>
                </TabsContent>
              </Tabs>

              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" onClick={saveCurrentRun} disabled={saving}>
                  <Save className="mr-1.5 h-3.5 w-3.5" />
                  {saving ? "Saving…" : "Save run"}
                </Button>
                <Button size="sm" variant="outline" onClick={downloadResult}>
                  <Download className="mr-1.5 h-3.5 w-3.5" />
                  Export run JSON
                </Button>
                <span className="text-[11px] text-muted-foreground">
                  Run {result.runId} · seed {result.seed} · {fmtInt(result.periods)} periods · engine {result.engine.bn}
                </span>
              </div>
            </>
          )}

          <ModelLimitations />
        </div>
      </div>
    </div>
  );
}
