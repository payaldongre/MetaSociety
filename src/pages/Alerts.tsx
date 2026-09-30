import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AlertCircle, AlertTriangle, BellOff, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { listRuns, type SavedRun } from "@/lib/runStore";
import { METRIC_LABELS } from "@/simulation";

const icons = { warning: AlertTriangle, danger: AlertCircle, info: Info } as const;
const colors = {
  warning: "border-warning/30 bg-warning/5",
  danger: "border-destructive/30 bg-destructive/5",
  info: "border-primary/30 bg-primary/5",
} as const;
const iconColors = { warning: "text-warning", danger: "text-destructive", info: "text-primary" } as const;

interface AlertRow {
  id: string;
  severity: keyof typeof icons;
  title: string;
  description: string;
  date: string;
  policyName: string;
}

export default function Alerts() {
  const [runs, setRuns] = useState<SavedRun[]>([]);
  useEffect(() => setRuns(listRuns()), []);

  const alerts = useMemo<AlertRow[]>(
    () =>
      runs.flatMap((run) =>
        run.alerts.map((alert, i) => ({
          id: `${run.id}-${i}`,
          severity: alert.severity,
          title: alert.message,
          description: `${METRIC_LABELS[alert.metric]} · ${run.policyName} (run ${run.runId})`,
          date: new Date(run.createdAt).toLocaleDateString(),
          policyName: run.policyName,
        })),
      ),
    [runs],
  );

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <div className="animate-fade-up">
        <h1 className="text-2xl font-bold text-foreground">Risk Alerts</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Threshold breaches raised by the simulations you have saved. Every alert is produced by the engine's own
          accounting and guardrail checks, not written by a model.
        </p>
      </div>

      {alerts.length === 0 && (
        <div className="animate-fade-up stagger-1 rounded-lg border bg-card p-10 text-center">
          <BellOff className="mx-auto mb-3 h-10 w-10 text-muted-foreground/30" />
          <p className="text-sm text-muted-foreground">
            {runs.length === 0
              ? "No saved runs yet, so there are no alerts. Run a policy in the Simulation Lab; any threshold the trajectory crosses is reported here."
              : "None of your saved runs crossed an alert threshold."}
          </p>
          <Button asChild size="sm" className="mt-4">
            <Link to="/simulation-lab">Open the Simulation Lab</Link>
          </Button>
        </div>
      )}

      <div className="space-y-3">
        {alerts.map((alert, i) => {
          const Icon = icons[alert.severity];
          return (
            <div
              key={alert.id}
              className={`animate-fade-up stagger-${Math.min(i + 1, 4)} flex items-start gap-3 rounded-lg border ${colors[alert.severity]} p-4`}
            >
              <Icon className={`mt-0.5 h-5 w-5 shrink-0 ${iconColors[alert.severity]}`} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-foreground">{alert.title}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{alert.description}</p>
              </div>
              <span className="whitespace-nowrap text-xs text-muted-foreground">{alert.date}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

