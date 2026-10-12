/**
 * Policy brief & governance panel (redesign spec §7, §8, §26, §27).
 *
 * Lets the user name EVERY governance role the model supports — proposer,
 * primary decision authority, and the approval / funding / implementing /
 * supporting authorities — derives the policy domains from the selected engine
 * channels, and shows the feasibility verdict: status, any blockers, the ordered
 * pathway (proposed → approved → funded → implemented) and the auto-filled legal
 * basis.
 *
 * The roles are NOT all auto-filled and hidden: each list starts from an honest
 * default (the deciding body funds and implements its own policy) but every role
 * is visible and editable, so a multi-authority pathway can be represented
 * instead of assumed.
 *
 * The validation itself lives in `@/simulation` — this component only renders it
 * and hands the structured brief up to the page, which runs it through the
 * engine's gate (`runPolicyBriefSimulation`). Nothing here reimplements the
 * governance logic.
 */

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Plus, Scale, ShieldAlert, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AUTHORITY_IDS,
  AUTHORITY_LABELS,
  DOMAIN_LABELS,
  GOVERNANCE_REGISTRY,
  validatePolicyBrief,
  type AuthorityId,
  type AuthorityRoles,
  type PolicyBrief,
  type PolicyDomain,
  type PolicyFeasibility,
} from "@/simulation";

/** Channel -> policy domain, so the form can derive competence automatically. */
const CHANNEL_DOMAIN: Record<string, PolicyDomain> = {
  INCOME_SUPPORT: "income_support",
  LABOR_MARKET: "labour_market",
  HOUSING: "housing",
  EDUCATION_SKILL: "education_skill",
  HEALTHCARE_ACCESS: "healthcare",
  TAX_FISCAL: "taxation_fiscal",
  REGULATION: "regulation",
  INFRASTRUCTURE: "infrastructure",
  ENVIRONMENT_CLIMATE: "environment_climate",
  DIGITAL_ACCESS: "digital_access",
  FOOD_SECURITY: "food_security",
  FINANCIAL_INCLUSION: "income_support",
  PILGRIMAGE_FACILITIES: "pilgrimage_facilities",
};

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

interface BudgetRow {
  label: string;
  amountCrore: number;
}
interface PhaseRow {
  name: string;
  startDate: string;
  endDate: string;
}

const DEFAULT_BUDGET: BudgetRow[] = [
  { label: "Direct transfers", amountCrore: 12 },
  { label: "Administration", amountCrore: 3 },
];
const DEFAULT_PHASES: PhaseRow[] = [
  { name: "Preparation", startDate: "2027-01-01", endDate: "2027-03-31" },
  { name: "Delivery", startDate: "2027-04-01", endDate: "2027-09-30" },
];

const CRORE = 1e7;

/** A compact multi-select of governance bodies rendered as toggle chips. */
function AuthorityChips({
  label,
  hint,
  selected,
  onChange,
}: {
  label: string;
  hint?: string;
  selected: AuthorityId[];
  onChange: (next: AuthorityId[]) => void;
}) {
  const toggle = (id: AuthorityId) =>
    onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between">
        <Label className="text-[11px]">{label}</Label>
        {selected.length === 0 && <span className="text-[10px] text-muted-foreground">none</span>}
      </div>
      <div className="flex flex-wrap gap-1">
        {AUTHORITY_IDS.map((id) => {
          const on = selected.includes(id);
          return (
            <button
              key={id}
              type="button"
              onClick={() => toggle(id)}
              className={`rounded-full border px-2 py-0.5 text-[10px] transition-colors ${
                on ? "border-primary bg-primary/15 text-primary" : "border-border bg-muted/30 text-muted-foreground hover:text-foreground"
              }`}
            >
              {AUTHORITY_LABELS[id]}
            </button>
          );
        })}
      </div>
      {hint && <p className="text-[10px] leading-snug text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function PolicyBriefPanel({
  channelIds,
  policyName = "",
  onBriefChange,
}: {
  channelIds: string[];
  policyName?: string;
  onBriefChange?: (brief: PolicyBrief, feasibility: PolicyFeasibility) => void;
}) {
  const [proposer, setProposer] = useState<AuthorityId>("pandharpur_municipal_council");
  const [decider, setDecider] = useState<AuthorityId>("pandharpur_municipal_council");
  const [approval, setApproval] = useState<AuthorityId[]>([]);
  const [funding, setFunding] = useState<AuthorityId[]>(["pandharpur_municipal_council"]);
  const [implementing, setImplementing] = useState<AuthorityId[]>(["pandharpur_municipal_council"]);
  const [supporting, setSupporting] = useState<AuthorityId[]>([]);
  const [budget, setBudget] = useState<BudgetRow[]>(DEFAULT_BUDGET);
  const [phases, setPhases] = useState<PhaseRow[]>(DEFAULT_PHASES);

  const domains = useMemo(() => {
    const set = new Set<PolicyDomain>();
    for (const id of channelIds) {
      const d = CHANNEL_DOMAIN[id];
      if (d) set.add(d);
    }
    return [...set];
  }, [channelIds]);

  const roles: AuthorityRoles = useMemo(
    () => ({
      proposingAuthority: proposer,
      primaryDecisionAuthority: decider,
      approvalAuthorities: approval,
      fundingAuthorities: funding,
      implementingAuthorities: implementing,
      supportingAuthorities: supporting,
    }),
    [proposer, decider, approval, funding, implementing, supporting],
  );

  const title = policyName.trim() || "Untitled policy";
  const totalInr = useMemo(() => Math.round(budget.reduce((a, b) => a + (Number.isFinite(b.amountCrore) ? b.amountCrore : 0), 0) * CRORE), [budget]);

  const brief: PolicyBrief = useMemo(
    () => ({
      id: "lab-brief",
      title,
      objective: `Deliver the "${title}" policy to Pandharpur residents.`,
      problemStatement: `Pandharpur (Solapur, Maharashtra) faces the pressures addressed by: ${
        domains.map((d) => DOMAIN_LABELS[d]).join(", ") || "the selected channels"
      }.`,
      governance: roles,
      domains: domains.length > 0 ? domains : ["regulation"],
      target: { description: "Pandharpur residents reached by the selected channels", wards: [] },
      budgetLineItems: budget.map((b) => ({ label: b.label, amountInr: Math.round((b.amountCrore || 0) * CRORE) })),
      statedTotalInr: totalInr,
      phases: phases.map((p) => ({ name: p.name, startDate: p.startDate, endDate: p.endDate })),
      channelIds,
    }),
    [title, roles, domains, budget, totalInr, phases, channelIds],
  );

  const feasibility = useMemo(() => validatePolicyBrief(brief), [brief]);

  useEffect(() => {
    onBriefChange?.(brief, feasibility);
  }, [brief, feasibility, onBriefChange]);

  const status = STATUS_STYLE[feasibility.status] ?? STATUS_STYLE.conditionally_feasible;
  const legalAuthorities = [...new Set([proposer, decider, ...approval, ...funding, ...implementing, ...supporting])];

  return (
    <Card className="border-border/70">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Scale className="h-4 w-4 text-primary" />
          Policy brief &amp; governance
        </CardTitle>
        <p className="text-[11px] leading-snug text-muted-foreground">
          The brief is the authoritative input: its budget line items and phase dates drive the engine, and the
          feasibility gate runs before any simulation. Competence is checked against a sourced registry — a policy that
          exceeds the selected authority&apos;s jurisdiction is blocked before it reaches the engine.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* --- identification --- */}
        <div className="space-y-1">
          <Label className="text-[11px]">Objective</Label>
          <p className="text-[11px] leading-snug text-muted-foreground">{brief.objective}</p>
        </div>

        {/* --- governance roles --- */}
        <div className="space-y-2 rounded-md border bg-muted/10 p-2">
          <p className="text-[11px] font-medium text-card-foreground">Governance roles</p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div className="space-y-1">
              <Label className="text-[11px]">Proposing authority</Label>
              <Select value={proposer} onValueChange={(v) => setProposer(v as AuthorityId)}>
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
              <Select value={decider} onValueChange={(v) => setDecider(v as AuthorityId)}>
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
            hint="Names must include any body whose approval the deciding authority legally requires."
            selected={approval}
            onChange={setApproval}
          />
          <AuthorityChips label="Funding authorities" selected={funding} onChange={setFunding} />
          <AuthorityChips label="Implementing authorities" selected={implementing} onChange={setImplementing} />
          <AuthorityChips label="Supporting authorities" selected={supporting} onChange={setSupporting} />
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] text-muted-foreground">Domains (from channels):</span>
          {domains.length === 0 ? (
            <span className="text-[11px] text-muted-foreground">none selected</span>
          ) : (
            domains.map((d) => (
              <Badge key={d} variant="outline" className="text-[10px]">
                {DOMAIN_LABELS[d]}
              </Badge>
            ))
          )}
        </div>

        {/* --- budget line items (the authoritative budget) --- */}
        <div className="space-y-1.5 rounded-md border bg-muted/10 p-2">
          <div className="flex items-center justify-between">
            <p className="text-[11px] font-medium text-card-foreground">Budget line items (₹ crore)</p>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-6 px-1.5 text-[10px]"
              onClick={() => setBudget((prev) => [...prev, { label: "New item", amountCrore: 1 }])}
            >
              <Plus className="mr-1 h-3 w-3" /> Add
            </Button>
          </div>
          {budget.map((row, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <Input
                className="h-7 flex-1 text-[11px]"
                value={row.label}
                onChange={(e) => setBudget((prev) => prev.map((r, j) => (j === i ? { ...r, label: e.target.value } : r)))}
              />
              <Input
                className="h-7 w-24 text-[11px]"
                inputMode="decimal"
                value={String(row.amountCrore)}
                onChange={(e) =>
                  setBudget((prev) => prev.map((r, j) => (j === i ? { ...r, amountCrore: Number(e.target.value) } : r)))
                }
              />
              {budget.length > 1 && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-7 px-1"
                  onClick={() => setBudget((prev) => prev.filter((_, j) => j !== i))}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              )}
            </div>
          ))}
          <p className="text-[10px] text-muted-foreground">
            Stated total: ₹{totalInr.toLocaleString("en-IN")} (sum of the items — the engine's budget is derived from
            this, never from a slider).
          </p>
        </div>

        {/* --- timeline phases (the authoritative duration) --- */}
        <div className="space-y-1.5 rounded-md border bg-muted/10 p-2">
          <div className="flex items-center justify-between">
            <p className="text-[11px] font-medium text-card-foreground">Implementation phases</p>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-6 px-1.5 text-[10px]"
              onClick={() => setPhases((prev) => [...prev, { name: "New phase", startDate: "2027-01-01", endDate: "2027-03-31" }])}
            >
              <Plus className="mr-1 h-3 w-3" /> Add
            </Button>
          </div>
          {phases.map((row, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <Input
                className="h-7 flex-1 text-[11px]"
                value={row.name}
                onChange={(e) => setPhases((prev) => prev.map((r, j) => (j === i ? { ...r, name: e.target.value } : r)))}
              />
              <Input
                className="h-7 w-28 text-[11px]"
                type="date"
                value={row.startDate}
                onChange={(e) => setPhases((prev) => prev.map((r, j) => (j === i ? { ...r, startDate: e.target.value } : r)))}
              />
              <Input
                className="h-7 w-28 text-[11px]"
                type="date"
                value={row.endDate}
                onChange={(e) => setPhases((prev) => prev.map((r, j) => (j === i ? { ...r, endDate: e.target.value } : r)))}
              />
              {phases.length > 1 && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-7 px-1"
                  onClick={() => setPhases((prev) => prev.filter((_, j) => j !== i))}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              )}
            </div>
          ))}
          <p className="text-[10px] text-muted-foreground">
            Duration derived from the phase dates: {feasibility.timeline.durationMonths} month(s).
          </p>
        </div>

        {/* --- verdict --- */}
        <div className={`flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-[11px] ${status.className}`}>
          {feasibility.simulationReady ? (
            <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
          ) : (
            <ShieldAlert className="h-3.5 w-3.5 shrink-0" />
          )}
          <span className="font-medium">{status.label}</span>
          <span className="ml-auto text-[10px]">{feasibility.simulationReady ? "Simulation-ready" : "Blocked"}</span>
        </div>

        {feasibility.blockers.length > 0 && (
          <div className="space-y-1">
            {feasibility.blockers.map((b, i) => (
              <p key={i} className="flex items-start gap-1.5 text-[11px] leading-snug text-destructive">
                <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                {b}
              </p>
            ))}
          </div>
        )}
        {feasibility.conditions.map((c, i) => (
          <p key={i} className="text-[11px] leading-snug text-muted-foreground">
            {c}
          </p>
        ))}

        <div className="rounded-md border bg-muted/20 p-2">
          <p className="mb-1 text-[11px] font-medium text-card-foreground">Governance pathway</p>
          <ol className="space-y-0.5">
            {feasibility.governance.pathway.map((step, i) => (
              <li key={i} className="text-[11px] text-muted-foreground">
                {step.step}: <span className="text-card-foreground">{step.label}</span>
              </li>
            ))}
          </ol>
        </div>

        <div className="rounded-md border bg-muted/20 p-2">
          <p className="mb-1 text-[11px] font-medium text-card-foreground">Legal basis (auto-filled)</p>
          {legalAuthorities.map((id) => (
            <p key={id} className="text-[11px] leading-snug text-muted-foreground">
              <span className="text-card-foreground">{GOVERNANCE_REGISTRY[id].name}</span> —{" "}
              {GOVERNANCE_REGISTRY[id].legalBasis.title}
            </p>
          ))}
          <p className="mt-1 text-[10px] leading-snug text-muted-foreground">
            No statutory monetary ceiling is asserted for any body: none could be verified, so none is invented. The
            ₹20 crore simulation safety limit is a model assumption, not a legal limit.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

export default PolicyBriefPanel;
