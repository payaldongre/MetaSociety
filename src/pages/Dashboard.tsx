import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { BarChart3, Bot, FlaskConical, AlertTriangle, TrendingUp, Clock } from "lucide-react";
import { listRuns, type SavedRun } from "@/lib/runStore";
import { townFacts } from "@/lib/townData";

const sections = [
  {
    title: "Town Data Intelligence",
    description:
      "Explore the Census-anchored population this platform simulates: demographics, work, income and sector composition, with a field-by-field provenance ledger.",
    icon: BarChart3,
    path: "/data-intelligence",
    color: "text-primary",
    bg: "bg-primary/5 hover:bg-primary/10",
    border: "border-primary/20",
  },
  {
    title: "AI Policy Advisor",
    description:
      "Describe your policy goals in plain language. Get AI-generated suggestions with benefits, risks, and affected groups — as starting points to test, never as outcomes.",
    icon: Bot,
    path: "/ai-advisor",
    color: "text-success",
    bg: "bg-success/5 hover:bg-success/10",
    border: "border-success/20",
  },
  {
    title: "Policy Simulation Lab",
    description:
      "Configure and run a policy against every citizen agent. Outcomes come from a Bayesian network and a policy search — not from a language model.",
    icon: FlaskConical,
    path: "/simulation-lab",
    color: "text-warning",
    bg: "bg-warning/5 hover:bg-warning/10",
    border: "border-warning/20",
  },
];

export default function Dashboard() {
  const { user } = useAuth();
  const firstName = user?.fullName?.split(" ")[0] || "there";
  const [runs, setRuns] = useState<SavedRun[]>([]);
  const [facts, setFacts] = useState<ReturnType<typeof townFacts> | null>(null);

  useEffect(() => {
    setRuns(listRuns());
    // Population generation is deliberately not cheap; defer it past first paint.
    const id = window.setTimeout(() => setFacts(townFacts()), 0);
    return () => window.clearTimeout(id);
  }, []);

  const latestAlert = useMemo(() => {
    for (const run of runs) {
      if (run.alerts.length > 0) return { run, alert: run.alerts[0] };
    }
    return null;
  }, [runs]);

  return (
    <div className="space-y-8">
      <section className="animate-fade-up">
        <h1 className="text-balance text-2xl font-bold leading-tight text-foreground sm:text-3xl">
          Welcome back, {firstName}
        </h1>
        <p className="mt-1 max-w-2xl text-muted-foreground">
          Understand, advise, and simulate policies for your community — against a virtual society first.
        </p>
        {facts && (
          <p className="mt-3 text-xs text-muted-foreground">
            Simulating {facts.town} ({facts.district}) — {facts.population.toLocaleString("en-IN")} citizen agents,{" "}
            {facts.households.toLocaleString("en-IN")} households, {facts.wards} wards.
          </p>
        )}
      </section>

      {latestAlert && (
        <div className="animate-fade-up stagger-1 flex items-start gap-3 rounded-lg border border-warning/30 bg-warning/5 p-4">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-warning" />
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground">{latestAlert.alert.message}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              From “{latestAlert.run.policyName}” · raised by the engine's own threshold checks
            </p>
          </div>
          <Link to="/alerts" className="ml-auto whitespace-nowrap text-xs font-medium text-primary hover:underline">
            View all
          </Link>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {sections.map((s, i) => (
          <Link
            key={s.path}
            to={s.path}
            className={`animate-fade-up stagger-${i + 1} group rounded-lg border ${s.border} ${s.bg} p-6 transition-all duration-300 hover:shadow-md active:scale-[0.98]`}
          >
            <s.icon className={`mb-3 h-8 w-8 ${s.color}`} />
            <h2 className="text-lg font-semibold text-foreground">{s.title}</h2>
            <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{s.description}</p>
          </Link>
        ))}
      </div>

      <section className="animate-fade-up stagger-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="flex items-center gap-2 font-semibold text-foreground">
            <Clock className="h-4 w-4 text-muted-foreground" />
            Recent Simulations
          </h2>
          <Link to="/saved-reports" className="text-sm text-primary hover:underline">
            View all
          </Link>
        </div>
        {runs.length === 0 ? (
          <div className="rounded-lg border bg-card p-8 text-center">
            <p className="text-sm text-muted-foreground">
              No saved simulations yet. Run a policy in the Simulation Lab and save it to see it here.
            </p>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {runs.slice(0, 6).map((run) => {
              const delta = run.headline.gdpGrowthPct - run.baseline.gdpGrowthPct;
              return (
                <div key={run.id} className="rounded-lg border bg-card p-4 transition-shadow hover:shadow-sm">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-card-foreground">{run.policyName}</p>
                      <p className="mt-0.5 text-xs capitalize text-muted-foreground">
                        {run.policyType} · {new Date(run.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <TrendingUp className="h-3.5 w-3.5 text-success" />
                      <span className="text-sm font-semibold text-card-foreground">
                        {run.effectivenessScore.toFixed(0)}
                      </span>
                    </div>
                  </div>
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    GDP vs no-policy {delta >= 0 ? "+" : "−"}
                    {Math.abs(delta).toFixed(1)}pp vs no-policy
                  </p>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
