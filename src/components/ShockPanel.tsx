/**
 * External-shock configuration panel.
 *
 * The policy workflow's third question (after "what is the policy?" and "what
 * does history ground it to?"): "what if an external event occurs DURING its
 * implementation?". The panel exposes the three modes the engine supports —
 * normal conditions, a deterministic hypothetical scenario, or a stochastic
 * stress test — and previews the exact event schedule before the run.
 *
 * It is deliberately explicit that these are hypothetical stress-test events,
 * not predictions, and that Poisson controls only the ARRIVAL of events.
 */

import { AlertTriangle, Plus, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  SHOCK_DEFINITIONS,
  SHOCK_SEVERITIES,
  generateShockSchedule,
  shockDefinitionById,
  type ManualShockSpec,
  type ShockScenarioConfig,
  type ShockSeverity,
  type StochasticShockSpec,
} from "@/simulation";

const MODES: { id: ShockScenarioConfig["mode"]; label: string; hint: string }[] = [
  { id: "none", label: "Normal conditions", hint: "No external events. The simplest default." },
  {
    id: "manual",
    label: "Hypothetical shock scenario",
    hint: "One known stress test at a chosen period, duration and severity.",
  },
  {
    id: "stochastic",
    label: "Stochastic shock stress test",
    hint: "Poisson arrivals generate hypothetical event timing from the configured rate.",
  },
];

const DEFAULT_RATE: Record<string, number> = Object.fromEntries(
  SHOCK_DEFINITIONS.map((d) => [d.id, d.defaultRatePerYear]),
);

const monthLabel = (period: number, monthsEach: number) => `month ≈ ${(period + 1) * monthsEach}`;

export function ShockPanel({
  scenario,
  onChange,
  periods,
  monthsEach,
  seed,
}: {
  scenario: ShockScenarioConfig;
  onChange: (scenario: ShockScenarioConfig) => void;
  periods: number;
  monthsEach: number;
  seed: number;
}) {
  const manual = scenario.manual ?? [];
  const stochastic = scenario.stochastic ?? [];
  const preview = generateShockSchedule(scenario, periods, monthsEach, seed);

  const patchManual = (list: ManualShockSpec[]) => onChange({ ...scenario, manual: list });
  const patchStochastic = (list: StochasticShockSpec[]) => onChange({ ...scenario, stochastic: list });

  return (
    <Card className="border-primary/20">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">External conditions</CardTitle>
        <p className="text-[11px] leading-snug text-muted-foreground">
          Does the policy stay robust if an unexpected external event occurs while it is being implemented? These are
          hypothetical stress-test events, not predictions.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-1">
          {MODES.map((m) => {
            const on = scenario.mode === m.id;
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => onChange({ mode: m.id, manual: scenario.manual, stochastic: scenario.stochastic })}
                className={`w-full rounded-md border px-2.5 py-1.5 text-left transition-colors ${
                  on ? "border-primary bg-primary/10" : "border-border bg-muted/20 hover:text-foreground"
                }`}
              >
                <span className="block text-[11px] font-medium text-card-foreground">{m.label}</span>
                <span className="block text-[10px] leading-snug text-muted-foreground">{m.hint}</span>
              </button>
            );
          })}
        </div>

        {scenario.mode === "manual" && (
          <div className="space-y-2 rounded-md border bg-muted/20 p-2">
            {manual.length === 0 && (
              <p className="text-[11px] text-muted-foreground">No event configured yet — add one below.</p>
            )}
            {manual.map((spec, i) => (
              <div key={i} className="space-y-1.5 rounded border bg-background/40 p-1.5">
                <div className="flex items-center gap-1.5">
                  <Select
                    value={spec.shockId}
                    onValueChange={(v) =>
                      patchManual(manual.map((x, j) => (j === i ? { ...x, shockId: v } : x)))
                    }
                  >
                    <SelectTrigger className="h-7 flex-1 text-[11px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {SHOCK_DEFINITIONS.map((d) => (
                        <SelectItem key={d.id} value={d.id} className="text-[11px]">
                          {d.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7"
                    onClick={() => patchManual(manual.filter((_, j) => j !== i))}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
                <div className="grid grid-cols-3 gap-1.5">
                  <div className="space-y-0.5">
                    <Label className="text-[10px] text-muted-foreground">Start period</Label>
                    <Input
                      className="h-7 text-[11px]"
                      type="number"
                      min={1}
                      max={periods}
                      value={spec.startPeriod + 1}
                      onChange={(e) =>
                        patchManual(
                          manual.map((x, j) =>
                            j === i ? { ...x, startPeriod: Math.max(0, Number(e.target.value) - 1) } : x,
                          ),
                        )
                      }
                    />
                  </div>
                  <div className="space-y-0.5">
                    <Label className="text-[10px] text-muted-foreground">Duration (periods)</Label>
                    <Input
                      className="h-7 text-[11px]"
                      type="number"
                      min={1}
                      max={periods}
                      value={spec.durationPeriods}
                      onChange={(e) =>
                        patchManual(
                          manual.map((x, j) => (j === i ? { ...x, durationPeriods: Math.max(1, Number(e.target.value)) } : x)),
                        )
                      }
                    />
                  </div>
                  <div className="space-y-0.5">
                    <Label className="text-[10px] text-muted-foreground">Severity</Label>
                    <Select
                      value={spec.severity}
                      onValueChange={(v) => patchManual(manual.map((x, j) => (j === i ? { ...x, severity: v as ShockSeverity } : x)))}
                    >
                      <SelectTrigger className="h-7 text-[11px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {SHOCK_SEVERITIES.map((s) => (
                          <SelectItem key={s} value={s} className="text-[11px]">
                            {s}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>
            ))}
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 text-[11px]"
              onClick={() =>
                patchManual([
                  ...manual,
                  {
                    shockId: SHOCK_DEFINITIONS[1].id,
                    startPeriod: Math.min(periods - 1, Math.floor(periods / 3)),
                    durationPeriods: 4,
                    severity: "moderate",
                  },
                ])
              }
            >
              <Plus className="mr-1 h-3 w-3" /> Add hypothetical event
            </Button>
          </div>
        )}

        {scenario.mode === "stochastic" && (
          <div className="space-y-2 rounded-md border bg-muted/20 p-2">
            <p className="text-[11px] leading-snug text-muted-foreground">
              Poisson models the ARRIVAL of hypothetical events, not their consequences. λ is a scenario assumption you
              set — it is not a sourced real-world hazard rate.
            </p>
            {stochastic.map((spec, i) => (
              <div key={i} className="grid grid-cols-[1fr_auto_auto_auto] items-end gap-1.5">
                <Select value={spec.shockId} onValueChange={(v) => patchStochastic(stochastic.map((x, j) => (j === i ? { ...x, shockId: v } : x)))}>
                  <SelectTrigger className="h-7 text-[11px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SHOCK_DEFINITIONS.map((d) => (
                      <SelectItem key={d.id} value={d.id} className="text-[11px]">
                        {d.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  className="h-7 w-16 text-[11px]"
                  type="number"
                  step={0.05}
                  min={0}
                  value={spec.ratePerYear}
                  onChange={(e) =>
                    patchStochastic(stochastic.map((x, j) => (j === i ? { ...x, ratePerYear: Math.max(0, Number(e.target.value)) } : x)))
                  }
                />
                <Input
                  className="h-7 w-14 text-[11px]"
                  type="number"
                  min={0}
                  value={spec.maxEvents ?? 8}
                  onChange={(e) =>
                    patchStochastic(stochastic.map((x, j) => (j === i ? { ...x, maxEvents: Math.max(0, Number(e.target.value)) } : x)))
                  }
                />
                <Button type="button" size="icon" variant="ghost" className="h-7 w-7" onClick={() => patchStochastic(stochastic.filter((_, j) => j !== i))}>
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            ))}
            <p className="text-[10px] text-muted-foreground">Columns: shock · λ events/year · max events.</p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 text-[11px]"
              onClick={() =>
                patchStochastic([
                  ...stochastic,
                  { shockId: SHOCK_DEFINITIONS[1].id, ratePerYear: DEFAULT_RATE[SHOCK_DEFINITIONS[1].id] ?? 0.2, maxEvents: 6 },
                ])
              }
            >
              <Plus className="mr-1 h-3 w-3" /> Add stochastic shock
            </Button>
          </div>
        )}

        {scenario.mode !== "none" && (
          <div className="space-y-1 rounded-md border bg-muted/20 p-2">
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] font-medium text-card-foreground">Scenario preview</span>
              <Badge variant="outline" className="text-[10px]">
                {preview.arrivalModel.toLowerCase()} arrival
              </Badge>
            </div>
            <p className="text-[10px] text-muted-foreground">
              Policy horizon {preview.periods} periods · seed {seed} · generated {preview.events.length} event(s)
            </p>
            {preview.events.length === 0 ? (
              <p className="text-[10px] text-muted-foreground">
                This seed generated no event. In stochastic mode, different seeds may generate different realizations.
              </p>
            ) : (
              preview.events.map((e, i) => (
                <p key={i} className="text-[10px] text-muted-foreground">
                  • Period {e.time + 1} ({monthLabel(e.time, monthsEach)}) — {e.severity} {shockDefinitionById(e.shockId)?.name ?? e.shockId}
                </p>
              ))
            )}
            <p className="text-[10px] text-muted-foreground">
              Baseline and proposed policy receive the same generated schedule, so policy differences stay comparable.
            </p>
          </div>
        )}

        {scenario.mode !== "none" && (
          <p className="flex items-start gap-1.5 text-[10px] leading-snug text-muted-foreground">
            <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-warning" />
            Poisson controls event arrival frequency; the event queue determines when scheduled events are applied; the
            Bayesian network determines their causal consequences. Shocks are exogenous — the same sequence is applied
            to the no-policy baseline and the policy.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
