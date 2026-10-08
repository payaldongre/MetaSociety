/**
 * Structured Policy Brief panel (redesign spec §7, §8, §26, §27).
 *
 * This is the AUTHORITATIVE policy-input workflow. A policy is not three sliders:
 * it is a government-style brief naming the objective, the governing authorities,
 * the targeted population, the budget line items and the implementation timeline.
 *
 * The panel only EDITS the brief and RENDERS the verdict; the validation itself
 * lives in `@/simulation/policy-brief` and `@/simulation/governance`, and the
 * same gate is re-run inside the engine (`runSimulation`), so a brief blocked
 * here can also never reach the simulation engine from any caller.
 *
 * The three former sliders (intensity, budget, duration) are not inputs here:
 * the budget is the sum of the real line items and the duration is the span of
 * the real phase dates. The panel shows the derived engine parameters so the
 * evaluator can see exactly what would be simulated.
 */

import { AlertTriangle, Calculator, CheckCircle2, Plus, Scale, ShieldAlert, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  AUTHORITY_IDS,
  AUTHORITY_LABELS,
  DOMAIN_LABELS,
  GOVERNANCE_REGISTRY,
  SIMULATION_SAFETY_LIMIT,
  type AuthorityId,
  type PolicyBrief,
  type PolicyFeasibility,
} from "@/simulation";

const STATUS_STYLE: Record<string, { label: string; className: string }> = {
  legally_feasible: { label: "Legally feasible", className: "bg-success/12 text-success border-success/30" },
  conditionally_feasible: { label: "Conditionally feasible", className: "bg-warning/12 text-warning border-warning/30" },
  requires_escalation: { label: "Requires escalation", className: "bg-warning/12 text-warning border-warning/30" },
  unsupported_by_authority: {
    label: "Unsupported by the selected authority",
    className: "bg-destructive/12 text-destructive border-destructive/30",
  },
  insufficient_evidence: { label: "Insufficient evidence", className: "bg-muted text-muted-foreground border-border" },
};

const crore = (inr: number) => `₹${(inr / 1e7).toFixed(2)} cr`;

/** Authority role picker rendered as toggle chips (multi) or a dropdown (single). */
function AuthorityChips({
  label,
  hint,
  selected,
  onToggle,
}: {
  label: string;
  hint: string;
  selected: AuthorityId[];
  onToggle: (id: AuthorityId) => void;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-[11px]">{label}</Label>
      <div className="flex flex-wrap gap-1">
        {AUTHORITY_IDS.map((id) => {
          const on = selected.includes(id);
          return (
            <button
              key={id}
              type="button"
              onClick={() => onToggle(id)}
              className={`rounded-full border px-2 py-0.5 text-[10px] transition-colors ${
                on
                  ? "border-primary bg-primary/15 text-primary"
                  : "border-border bg-muted/30 text-muted-foreground hover:text-foreground"
              }`}
            >
              {AUTHORITY_LABELS[id]}
            </button>
          );
        })}
      </div>
      <p className="text-[10px] leading-snug text-muted-foreground">{hint}</p>
    </div>
  );
}

export function PolicyBriefPanel({
  brief,
  feasibility,
  onChange,
}: {
  brief: PolicyBrief;
  feasibility: PolicyFeasibility;
  onChange: (brief: PolicyBrief) => void;
}) {
  const status = STATUS_STYLE[feasibility.status] ?? STATUS_STYLE.conditionally_feasible;

  const patch = (partial: Partial<PolicyBrief>) => onChange({ ...brief, ...partial });

  const toggleRole = (key: keyof PolicyBrief["governance"], id: AuthorityId) => {
    if (key === "proposingAuthority" || key === "primaryDecisionAuthority") {
      patch({ governance: { ...brief.governance, [key]: id } });
      return;
    }
    const current = brief.governance[key];
    const next = current.includes(id) ? current.filter((x) => x !== id) : [...current, id];
    patch({ governance: { ...brief.governance, [key]: next } });
  };

  const lineItemTotal = brief.budgetLineItems.reduce((a, b) => a + b.amountInr, 0);

  const legalBasis = [...new Set([
    brief.governance.primaryDecisionAuthority,
    brief.governance.proposingAuthority,
    ...brief.governance.approvalAuthorities,
    ...brief.governance.fundingAuthorities,
    ...brief.governance.implementingAuthorities,
    ...brief.governance.supportingAuthorities,
  ])];

  return (
    <Card className="border-primary/30">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Scale className="h-4 w-4 text-primary" />
          Policy brief &amp; governance
        </CardTitle>
        <p className="text-[11px] leading-snug text-muted-foreground">
          The structured brief is the authoritative definition of the policy. Competence, budget and timeline are
          checked here <span className="font-medium">and again inside the engine</span> — a blocked policy cannot
          reach the simulation.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* ---------------- verdict ---------------- */}
        <div className={`flex flex-wrap items-center gap-2 rounded-md border px-2.5 py-1.5 text-[11px] ${status.className}`}>
          {feasibility.status === "unsupported_by_authority" ? (
            <ShieldAlert className="h-3.5 w-3.5 shrink-0" />
          ) : (
            <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
          )}
          <span className="font-medium">{status.label}</span>
          <Badge variant="outline" className="ml-auto text-[10px]">
            {feasibility.simulationReady ? "Simulation-ready" : "Blocked from simulation"}
          </Badge>
        </div>

        {feasibility.blockers.length > 0 && (
          <div className="space-y-1 rounded-md border border-destructive/40 bg-destructive/5 p-2">
            <p className="text-[11px] font-medium text-destructive">Blocking problems (must be fixed)</p>
            {feasibility.blockers.map((b, i) => (
              <p key={i} className="flex items-start gap-1.5 text-[11px] leading-snug text-destructive">
                <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                {b}
              </p>
            ))}
          </div>
        )}
        {feasibility.conditions.map((c, i) => (
          <p key={i} className="text-[11px] leading-snug text-warning">
            {c}
          </p>
        ))}

        {/* ---------------- identification ---------------- */}
        <div className="space-y-2">
          <div className="space-y-1">
            <Label className="text-[11px]">Policy title</Label>
            <Input className="h-8 text-xs" value={brief.title} onChange={(e) => patch({ title: e.target.value })} />
          </div>
          <div className="space-y-1">
            <Label className="text-[11px]">Objective</Label>
            <Textarea
              className="min-h-[48px] text-xs"
              value={brief.objective}
              onChange={(e) => patch({ objective: e.target.value })}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-[11px]">Problem statement</Label>
            <Textarea
              className="min-h-[48px] text-xs"
              value={brief.problemStatement}
              onChange={(e) => patch({ problemStatement: e.target.value })}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-[11px]">Target population</Label>
            <Input
              className="h-8 text-xs"
              value={brief.target.description}
              onChange={(e) => patch({ target: { ...brief.target, description: e.target.value } })}
            />
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] text-muted-foreground">Domains (from channels):</span>
            {brief.domains.length === 0 ? (
              <span className="text-[11px] text-muted-foreground">none — select a channel</span>
            ) : (
              brief.domains.map((d) => (
                <Badge key={d} variant="outline" className="text-[10px]">
                  {DOMAIN_LABELS[d]}
                </Badge>
              ))
            )}
          </div>
        </div>

        {/* ---------------- governance roles ---------------- */}
        <div className="space-y-2 rounded-md border bg-muted/20 p-2">
          <p className="text-[11px] font-medium text-card-foreground">Governance roles</p>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-[11px]">Proposing authority</Label>
              <Select
                value={brief.governance.proposingAuthority}
                onValueChange={(v) => toggleRole("proposingAuthority", v as AuthorityId)}
              >
                <SelectTrigger className="h-8 text-[11px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {AUTHORITY_IDS.map((id) => (
                    <SelectItem key={id} value={id} className="text-[11px]">
                      {AUTHORITY_LABELS[id]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-[11px]">Primary decision authority</Label>
              <Select
                value={brief.governance.primaryDecisionAuthority}
                onValueChange={(v) => toggleRole("primaryDecisionAuthority", v as AuthorityId)}
              >
                <SelectTrigger className="h-8 text-[11px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {AUTHORITY_IDS.map((id) => (
                    <SelectItem key={id} value={id} className="text-[11px]">
                      {AUTHORITY_LABELS[id]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <AuthorityChips
            label="Approval authorities"
            hint="Bodies whose sanction is required before the decision takes effect."
            selected={brief.governance.approvalAuthorities}
            onToggle={(id) => toggleRole("approvalAuthorities", id)}
          />
          <AuthorityChips
            label="Funding authorities"
            hint="Bodies that would meet the cost."
            selected={brief.governance.fundingAuthorities}
            onToggle={(id) => toggleRole("fundingAuthorities", id)}
          />
          <AuthorityChips
            label="Implementing authorities"
            hint="Bodies that would carry out the works."
            selected={brief.governance.implementingAuthorities}
            onToggle={(id) => toggleRole("implementingAuthorities", id)}
          />
          <AuthorityChips
            label="Supporting authorities"
            hint="Bodies that support the policy without deciding it."
            selected={brief.governance.supportingAuthorities}
            onToggle={(id) => toggleRole("supportingAuthorities", id)}
          />
        </div>

        {/* ---------------- budget ---------------- */}
        <div className="space-y-2 rounded-md border bg-muted/20 p-2">
          <div className="flex items-center justify-between">
            <p className="text-[11px] font-medium text-card-foreground">Budget (line items)</p>
            <span className="text-[11px] text-muted-foreground">sum {crore(lineItemTotal)}</span>
          </div>
          {brief.budgetLineItems.map((item, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <Input
                className="h-7 flex-1 text-[11px]"
                value={item.label}
                placeholder="Line item"
                onChange={(e) => {
                  const items = brief.budgetLineItems.map((x, j) => (j === i ? { ...x, label: e.target.value } : x));
                  patch({ budgetLineItems: items });
                }}
              />
              <Input
                className="h-7 w-24 text-[11px]"
                type="number"
                min={0}
                step={0.1}
                value={item.amountInr / 1e7}
                onChange={(e) => {
                  const amountInr = Math.round(Number(e.target.value) * 1e7);
                  const items = brief.budgetLineItems.map((x, j) => (j === i ? { ...x, amountInr } : x));
                  patch({ budgetLineItems: items });
                }}
              />
              <span className="w-6 text-[10px] text-muted-foreground">cr</span>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="h-7 w-7"
                onClick={() => patch({ budgetLineItems: brief.budgetLineItems.filter((_, j) => j !== i) })}
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
          ))}
          <div className="flex flex-wrap items-center gap-1.5">
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 text-[11px]"
              onClick={() =>
                patch({ budgetLineItems: [...brief.budgetLineItems, { label: "New line item", amountInr: 0 }] })
              }
            >
              <Plus className="mr-1 h-3 w-3" /> Add line item
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 text-[11px]"
              onClick={() => patch({ statedTotalInr: lineItemTotal })}
            >
              <Calculator className="mr-1 h-3 w-3" /> Set stated total to line-item sum
            </Button>
          </div>
          <div className="space-y-1">
            <Label className="text-[11px]">Stated total requested</Label>
            <div className="flex items-center gap-1.5">
              <Input
                className="h-7 w-28 text-[11px]"
                type="number"
                min={0}
                step={0.1}
                value={brief.statedTotalInr / 1e7}
                onChange={(e) => patch({ statedTotalInr: Math.round(Number(e.target.value) * 1e7) })}
              />
              <span className="text-[10px] text-muted-foreground">₹ crore</span>
            </div>
            <p className={`text-[10px] leading-snug ${feasibility.budget.matches ? "text-success" : "text-destructive"}`}>
              {feasibility.budget.matches
                ? "The line items equal the stated total exactly."
                : `The line items sum to ${crore(feasibility.budget.totalLineItems)} while the stated total is ${crore(feasibility.budget.statedTotal)} — the brief is blocked until they agree.`}
            </p>
            <p className="text-[10px] leading-snug text-muted-foreground">
              The ₹{(SIMULATION_SAFETY_LIMIT.amountInr / 1e7).toFixed(0)} crore simulation safety limit is a model
              assumption that bounds the search space, not a legal spending ceiling.
            </p>
          </div>
        </div>

        {/* ---------------- timeline ---------------- */}
        <div className="space-y-2 rounded-md border bg-muted/20 p-2">
          <p className="text-[11px] font-medium text-card-foreground">Implementation timeline</p>
          {brief.phases.map((phase, i) => (
            <div key={i} className="space-y-1 rounded border bg-background/40 p-1.5">
              <div className="flex items-center gap-1.5">
                <Input
                  className="h-7 flex-1 text-[11px]"
                  value={phase.name}
                  placeholder="Phase name"
                  onChange={(e) => {
                    const phases = brief.phases.map((x, j) => (j === i ? { ...x, name: e.target.value } : x));
                    patch({ phases });
                  }}
                />
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7"
                  onClick={() => patch({ phases: brief.phases.filter((_, j) => j !== i) })}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
              <div className="flex items-center gap-1.5">
                <Input
                  className="h-7 text-[11px]"
                  type="date"
                  value={phase.startDate}
                  onChange={(e) => {
                    const phases = brief.phases.map((x, j) => (j === i ? { ...x, startDate: e.target.value } : x));
                    patch({ phases });
                  }}
                />
                <span className="text-[10px] text-muted-foreground">to</span>
                <Input
                  className="h-7 text-[11px]"
                  type="date"
                  value={phase.endDate}
                  onChange={(e) => {
                    const phases = brief.phases.map((x, j) => (j === i ? { ...x, endDate: e.target.value } : x));
                    patch({ phases });
                  }}
                />
              </div>
            </div>
          ))}
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 text-[11px]"
            onClick={() =>
              patch({ phases: [...brief.phases, { name: "New phase", startDate: "", endDate: "" }] })
            }
          >
            <Plus className="mr-1 h-3 w-3" /> Add phase
          </Button>
          <p className={`text-[10px] leading-snug ${feasibility.timeline.valid ? "text-success" : "text-destructive"}`}>
            {feasibility.timeline.valid
              ? `Derives an engine duration of ${feasibility.timeline.durationMonths} months from the phase dates.`
              : feasibility.timeline.problems.join(" ")}
          </p>
        </div>

        {/* ---------------- derived + pathway ---------------- */}
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="rounded-md border bg-muted/20 p-2">
            <p className="mb-1 text-[11px] font-medium text-card-foreground">Derived engine parameters</p>
            <p className="text-[11px] text-muted-foreground">
              Budget {crore(feasibility.derived.budgetInr)} · duration {feasibility.derived.durationMonths} months
            </p>
            <p className="mt-1 text-[10px] leading-snug text-muted-foreground">
              Derived from the line items and the phase dates, not typed as bare sliders.
            </p>
          </div>
          <div className="rounded-md border bg-muted/20 p-2">
            <p className="mb-1 text-[11px] font-medium text-card-foreground">Governance pathway</p>
            <ol className="space-y-0.5">
              {feasibility.governance.pathway.map((step, i) => (
                <li key={i} className="text-[10px] text-muted-foreground">
                  {step.step}: <span className="text-card-foreground">{step.label}</span>
                </li>
              ))}
            </ol>
          </div>
        </div>

        <div className="rounded-md border bg-muted/20 p-2">
          <p className="mb-1 text-[11px] font-medium text-card-foreground">Legal basis (auto-filled from the registry)</p>
          {legalBasis.map((id) => (
            <p key={id} className="text-[11px] leading-snug text-muted-foreground">
              <span className="text-card-foreground">{GOVERNANCE_REGISTRY[id].name}</span> —{" "}
              {GOVERNANCE_REGISTRY[id].legalBasis.title}
            </p>
          ))}
          <p className="mt-1 text-[10px] leading-snug text-muted-foreground">
            No statutory monetary ceiling is asserted for any body: none could be verified, so none is invented.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
