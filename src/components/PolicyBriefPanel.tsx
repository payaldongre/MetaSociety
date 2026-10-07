/**
 * Policy brief & governance panel (redesign spec §7, §8, §26, §27).
 *
 * Lets the user name the authorities who would propose and decide a policy,
 * derives the policy domains from the selected engine channels, and shows the
 * governance verdict: feasibility status, any blockers, the ordered pathway
 * (proposed → approved → funded → implemented) and the auto-filled legal basis.
 *
 * The validation itself lives in `@/simulation/governance` — this component only
 * renders it. A policy that fails validation is visibly blocked here; the same
 * `validateGovernance` gate is available to the engine layer.
 */

import { useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Scale, ShieldAlert } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AUTHORITY_IDS,
  AUTHORITY_LABELS,
  DOMAIN_LABELS,
  GOVERNANCE_REGISTRY,
  validateGovernance,
  type AuthorityId,
  type PolicyDomain,
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

export function PolicyBriefPanel({ channelIds }: { channelIds: string[] }) {
  const [proposer, setProposer] = useState<AuthorityId>("pandharpur_municipal_council");
  const [decider, setDecider] = useState<AuthorityId>("pandharpur_municipal_council");

  const domains = useMemo(() => {
    const set = new Set<PolicyDomain>();
    for (const id of channelIds) {
      const d = CHANNEL_DOMAIN[id];
      if (d) set.add(d);
    }
    return [...set];
  }, [channelIds]);

  const finding = useMemo(
    () =>
      validateGovernance(
        {
          proposingAuthority: proposer,
          primaryDecisionAuthority: decider,
          approvalAuthorities: [],
          fundingAuthorities: [decider],
          implementingAuthorities: [decider],
          supportingAuthorities: [],
        },
        domains.length > 0 ? domains : ["regulation"],
      ),
    [proposer, decider, domains],
  );

  const status = STATUS_STYLE[finding.status] ?? STATUS_STYLE.conditionally_feasible;

  return (
    <Card className="border-border/70">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Scale className="h-4 w-4 text-primary" />
          Policy brief &amp; governance
        </CardTitle>
        <p className="text-[11px] leading-snug text-muted-foreground">
          Competence is checked against a sourced registry. A policy that exceeds the selected authority&apos;s
          jurisdiction is blocked here before it reaches the engine.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
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
            <Label className="text-[11px]">Decision authority</Label>
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

        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] text-muted-foreground">Domains:</span>
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

        <div className={`flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-[11px] ${status.className}`}>
          {finding.status === "unsupported_by_authority" ? (
            <ShieldAlert className="h-3.5 w-3.5 shrink-0" />
          ) : (
            <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
          )}
          <span className="font-medium">{status.label}</span>
        </div>

        {finding.blockers.length > 0 && (
          <div className="space-y-1">
            {finding.blockers.map((b, i) => (
              <p key={i} className="flex items-start gap-1.5 text-[11px] leading-snug text-destructive">
                <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                {b}
              </p>
            ))}
          </div>
        )}
        {finding.conditions.map((c, i) => (
          <p key={i} className="text-[11px] leading-snug text-muted-foreground">
            {c}
          </p>
        ))}

        <div className="rounded-md border bg-muted/20 p-2">
          <p className="mb-1 text-[11px] font-medium text-card-foreground">Governance pathway</p>
          <ol className="space-y-0.5">
            {finding.pathway.map((step, i) => (
              <li key={i} className="text-[11px] text-muted-foreground">
                {step.step}: <span className="text-card-foreground">{step.label}</span>
              </li>
            ))}
          </ol>
        </div>

        <div className="rounded-md border bg-muted/20 p-2">
          <p className="mb-1 text-[11px] font-medium text-card-foreground">Legal basis (auto-filled)</p>
          {[decider, proposer]
            .filter((v, i, a) => a.indexOf(v) === i)
            .map((id) => (
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
