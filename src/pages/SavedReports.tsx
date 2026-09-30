import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Download, FlaskConical, Search, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { deleteRun, listRuns, supabaseConfigured, type SavedRun } from "@/lib/runStore";
import { METRIC_LABELS, type MetricKey } from "@/simulation";

const HEADLINE_KEYS: MetricKey[] = ["gdpGrowthPct", "employmentRatePct", "happinessIndex"];

export default function SavedReports() {
  const [runs, setRuns] = useState<SavedRun[]>([]);
  const [query, setQuery] = useState("");

  useEffect(() => {
    setRuns(listRuns());
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return runs;
    return runs.filter((run) => run.policyName.toLowerCase().includes(q) || run.policyType.includes(q));
  }, [runs, query]);

  const remove = useCallback((id: string) => {
    setRuns(deleteRun(id));
    toast.success("Report deleted");
  }, []);

  const exportRun = useCallback((run: SavedRun) => {
    const blob = new Blob([JSON.stringify(run.result, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${run.runId}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <div className="animate-fade-up">
        <h1 className="text-2xl font-bold text-foreground">Saved Reports</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Simulation runs you saved from the Policy Simulation Lab. Each report is the engine's own output —
          headline metrics, their no-policy baseline, and the alerts the run raised.
        </p>
        <p className="mt-2 text-[11px] text-muted-foreground">
          {supabaseConfigured()
            ? "Storage: local browser store, with Supabase sync enabled."
            : "Storage: local browser store. Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY to sync across devices."}
        </p>
      </div>

      <div className="relative animate-fade-up stagger-1">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search saved simulations…"
          className="pl-9"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {filtered.length === 0 && (
        <div className="animate-fade-up stagger-2 rounded-lg border bg-card p-10 text-center">
          <FlaskConical className="mx-auto mb-3 h-10 w-10 text-muted-foreground/30" />
          <p className="text-sm text-muted-foreground">
            {runs.length === 0
              ? "No saved runs yet. Run a policy in the Simulation Lab and press Save."
              : "No saved run matches that search."}
          </p>
          {runs.length === 0 && (
            <Button asChild size="sm" className="mt-4">
              <Link to="/simulation-lab">Open the Simulation Lab</Link>
            </Button>
          )}
        </div>
      )}

      <div className="space-y-3 stagger-2 animate-fade-up">
        {filtered.map((run) => (
          <div key={run.id} className="rounded-lg border bg-card p-4">
            <div className="flex items-start gap-3">
              <FlaskConical className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-card-foreground">{run.policyName}</p>
                <p className="mt-0.5 text-xs capitalize text-muted-foreground">
                  {run.policyType} · run {run.runId} · {new Date(run.createdAt).toLocaleString()}
                  {run.syncedToSupabase ? " · synced" : ""}
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {HEADLINE_KEYS.map((key) => {
                    const delta = run.headline[key] - run.baseline[key];
                    return (
                      <Badge key={key} variant="outline" className="text-[11px]">
                        {METRIC_LABELS[key]} {delta >= 0 ? "+" : "−"}
                        {Math.abs(delta).toFixed(1)}
                      </Badge>
                    );
                  })}
                  <Badge variant="outline" className="text-[11px]">
                    score {run.effectivenessScore.toFixed(1)}
                  </Badge>
                  {run.alerts.length > 0 && (
                    <Badge variant="outline" className="border-warning/40 bg-warning/10 text-warning text-[11px]">
                      {run.alerts.length} alert{run.alerts.length === 1 ? "" : "s"}
                    </Badge>
                  )}
                </div>
              </div>
              <div className="flex shrink-0 gap-1">
                <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => exportRun(run)} title="Export run JSON">
                  <Download className="h-4 w-4" />
                </Button>
                <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => remove(run.id)} title="Delete report">
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
