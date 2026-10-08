/**
 * Historical validation panel (spec §16, §19, §40D).
 *
 * Lists the documented historical cases and, on demand, runs them through the
 * ACTUAL simulation engine (`runEngineBacktestSuite`) so the evaluator can see a
 * real prediction compared with a real observation. Cases the engine cannot
 * represent are labelled as such rather than given a fabricated prediction, and
 * a direction-only agreement is never shown as an accuracy claim.
 */

import { useState } from "react";
import { AlertTriangle, FlaskConical, History, Play, ShieldCheck } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  BACKTEST_CASES,
  runEngineBacktestSuite,
  type BacktestResult,
  type BacktestStatus,
  type BacktestSummary,
} from "@/simulation";

const STATUS_STYLE: Record<BacktestStatus, string> = {
  supported: "border-success/40 bg-success/10 text-success",
  partially_supported: "border-warning/40 bg-warning/10 text-warning",
  directionally_consistent: "border-primary/40 bg-primary/10 text-primary",
  inconclusive: "border-border bg-muted text-muted-foreground",
  not_representable: "border-border bg-muted text-muted-foreground",
  insufficient_evidence: "border-destructive/40 bg-destructive/10 text-destructive",
};

const STATUS_LABEL: Record<BacktestStatus, string> = {
  supported: "Supported",
  partially_supported: "Partially supported",
  directionally_consistent: "Directionally consistent",
  inconclusive: "Inconclusive",
  not_representable: "Not representable",
  insufficient_evidence: "Insufficient evidence",
};

export function HistoricalBacktestPanel() {
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<BacktestResult[] | null>(null);
  const [summary, setSummary] = useState<BacktestSummary | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const run = async () => {
    setRunning(true);
    setFailure(null);
    try {
      const outcome = await runEngineBacktestSuite({ simulation: { intervalRounds: 1 } });
      setResults(outcome.results);
      setSummary(outcome.summary);
    } catch (error) {
      setFailure(error instanceof Error ? error.message : String(error));
    } finally {
      setRunning(false);
    }
  };

  return (
    <Card className="animate-fade-up border-primary/20">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <History className="h-4 w-4 text-primary" /> Historical validation (backtest)
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Documented Pandharpur-relevant interventions, replayed through this same engine from pre-policy information
          only, and compared with what was observed afterwards. A direction-only agreement is reported as such, and a
          case the engine cannot represent is labelled rather than given an invented prediction.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs">Case</TableHead>
                <TableHead className="text-xs">Metric</TableHead>
                <TableHead className="text-xs">Observed</TableHead>
                <TableHead className="text-xs">Evidence</TableHead>
                <TableHead className="text-xs">Calibration</TableHead>
                <TableHead className="text-xs">Engine representation</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {BACKTEST_CASES.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="text-xs font-medium">{c.policy}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{c.metric}</TableCell>
                  <TableCell className="text-xs">{c.observedDirection}</TableCell>
                  <TableCell className="text-xs">{c.evidenceStrength}</TableCell>
                  <TableCell className="text-xs">{c.calibrationStatus}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {c.representation.engine ? (
                      <span className="text-card-foreground">{c.representation.engine.channelIds.join(", ")} → {c.representation.engine.metric}</span>
                    ) : (
                      <span>not representable — {c.representation.note.slice(0, 90)}…</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        <Button size="sm" variant="outline" onClick={run} disabled={running}>
          <Play className="mr-1.5 h-3.5 w-3.5" />
          {running ? "Running the engine backtest…" : "Run engine backtest"}
        </Button>

        {failure && (
          <p className="flex items-start gap-1.5 text-xs text-destructive">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {failure}
          </p>
        )}

        {summary && results && (
          <div className="space-y-3">
            <div className="flex items-start gap-2 rounded-md border bg-muted/20 p-2.5">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <div>
                <p className="text-xs font-medium text-card-foreground">Backtest summary</p>
                <p className="text-[11px] text-muted-foreground">{summary.note}</p>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Leakage checks: {summary.leakageFailures === 0 ? "clean" : `${summary.leakageFailures} failure(s)`}.
                  {summary.magnitudeChecks === 0
                    ? " No case has a comparable observed magnitude, so no magnitude accuracy is claimed."
                    : ` ${summary.magnitudeChecks} magnitude comparison(s).`}
                </p>
              </div>
            </div>

            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Case</TableHead>
                    <TableHead className="text-xs">Status</TableHead>
                    <TableHead className="text-xs">Predicted</TableHead>
                    <TableHead className="text-xs">Observed</TableHead>
                    <TableHead className="text-xs">Engine effect (seed interval)</TableHead>
                    <TableHead className="text-xs">Why</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {results.map((r) => (
                    <TableRow key={r.caseId}>
                      <TableCell className="text-xs font-medium">{r.policy}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={`text-[10px] ${STATUS_STYLE[r.status]}`}>
                          {STATUS_LABEL[r.status]}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs">
                        {r.engineRun ? r.predictedDirection : "—"}
                      </TableCell>
                      <TableCell className="text-xs">{r.comparedObservedDirection}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {r.engineRun
                          ? `${r.engineRun.delta >= 0 ? "+" : ""}${r.engineRun.delta.toFixed(2)} (${r.engineRun.seedInterval[0].toFixed(2)} to ${r.engineRun.seedInterval[1].toFixed(2)})`
                          : "no engine representation"}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{r.note}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <p className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
              <FlaskConical className="mt-0.5 h-3 w-3 shrink-0" />
              The engine effect is a modelled quantity, and the interval is an empirical seed interval — not a
              statistical confidence interval. Instrument magnitudes remain uncalibrated against an evaluated programme.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
