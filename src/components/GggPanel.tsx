/**
 * Evaluator-facing GGG panel.
 *
 * A concise summary, with the detailed evidence, inheritance and lineage behind
 * native disclosure elements so the page does not become a wall of text. Every
 * value is read from the run's `ggg` result — this component computes nothing.
 */

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { History, Info, Network } from "lucide-react";
import { historicalPolicyById } from "@/simulation/historical-policies";
import type { GggInheritance } from "@/simulation/ggg";

function relevance(score: number): { label: string; className: string } {
  if (score >= 0.6) return { label: "High relevance", className: "border-success/40 bg-success/10 text-success" };
  if (score >= 0.45) return { label: "Medium relevance", className: "border-warning/40 bg-warning/10 text-warning" };
  return { label: "Low relevance", className: "border-border bg-muted text-muted-foreground" };
}

const CALIBRATION_CLASS: Record<string, string> = {
  high: "border-success/40 bg-success/10 text-success",
  moderate: "border-primary/40 bg-primary/10 text-primary",
  limited: "border-warning/40 bg-warning/10 text-warning",
  uncalibrated: "border-border bg-muted text-muted-foreground",
};

export function GggPanel({ ggg }: { ggg: GggInheritance }) {
  const parents = ggg.parents;
  return (
    <Card className="animate-fade-up border-primary/20">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <History className="h-4 w-4 text-primary" />
          Historical policy inheritance (GGG)
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          The proposed policy inherits characteristics from real predecessor policies and adapts them to Pandharpur.
          GGG is a deterministic inheritance mechanism — not an LLM, not Differential Evolution, and it never copies a
          historical outcome into a result.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* parents */}
        <div>
          <p className="mb-1.5 text-xs font-medium text-card-foreground">Historical parents</p>
          {parents.length === 0 ? (
            <p className="text-[11px] text-muted-foreground">
              No historical predecessor met the similarity threshold. The policy runs at the conservative floor effect
              scale and its magnitude is explicitly uncalibrated.
            </p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {parents.map((p) => {
                const rel = relevance(p.overall);
                return (
                  <Badge key={p.policyId} variant="outline" className={rel.className} title={p.reason}>
                    {p.name} · {p.channel} · {rel.label}
                  </Badge>
                );
              })}
            </div>
          )}
        </div>

        {/* inherited characteristics */}
        <div>
          <p className="mb-1.5 text-xs font-medium text-card-foreground">Inherited characteristics</p>
          {ggg.inheritedTraits.length === 0 ? (
            <p className="text-[11px] text-muted-foreground">No trait had sufficient parent support to be inherited.</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {ggg.inheritedTraits.map((t) => (
                <span
                  key={t.trait}
                  className="rounded-full border bg-muted/30 px-2 py-0.5 text-[11px] text-muted-foreground"
                  title={`supported by ${t.supportingParents.join(", ")} · confidence ${t.confidence.toFixed(2)}`}
                >
                  {t.trait.replace(/_/g, " ")}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* grounded characteristics */}
        <div className="grid gap-2 sm:grid-cols-4">
          <div className="rounded-md border p-2.5">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Evidence strength</p>
            <p className="text-sm font-medium text-card-foreground">{ggg.evidenceStrength}</p>
          </div>
          <div className="rounded-md border p-2.5">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Numerical calibration</p>
            <Badge variant="outline" className={`mt-0.5 ${CALIBRATION_CLASS[ggg.magnitudeCalibration]}`}>
              {ggg.magnitudeCalibration}
            </Badge>
          </div>
          <div className="rounded-md border p-2.5">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Grounded effect scale</p>
            <p className="text-sm font-medium text-card-foreground">{ggg.grounded.effectScale.toFixed(3)}</p>
          </div>
          <div className="rounded-md border p-2.5">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Parents</p>
            <p className="text-sm font-medium text-card-foreground">{parents.length}</p>
          </div>
        </div>

        <p className="text-[11px] leading-snug text-muted-foreground">
          The grounded effect scale is folded into the intensity and budget bands the Bayesian network reads, so a small
          local policy cannot produce a larger programme's effect. Direction evidence and magnitude calibration are
          reported separately: a supported direction does not imply a calibrated magnitude.
        </p>

        {/* adaptation */}
        <details className="rounded-md border bg-muted/20 p-2.5">
          <summary className="cursor-pointer text-xs font-medium text-card-foreground">
            View Pandharpur adaptation ({ggg.adaptation.length})
          </summary>
          <div className="mt-2 space-y-1.5">
            {ggg.adaptation.map((a) => (
              <p key={a.dimension} className="text-[11px] leading-snug text-muted-foreground">
                <span className="font-medium text-card-foreground">{a.dimension}</span> — historical: {a.historical} ·
                Pandharpur: {a.pandharpur}. {a.note}
              </p>
            ))}
          </div>
        </details>

        {/* inheritance detail */}
        <details className="rounded-md border bg-muted/20 p-2.5">
          <summary className="cursor-pointer text-xs font-medium text-card-foreground">
            View inheritance ({ggg.inheritedTraits.length} traits)
          </summary>
          <div className="mt-2 space-y-1.5">
            {ggg.inheritedTraits.length === 0 && (
              <p className="text-[11px] text-muted-foreground">No inherited traits.</p>
            )}
            {ggg.inheritedTraits.map((t) => (
              <p key={t.trait} className="text-[11px] leading-snug text-muted-foreground">
                <span className="font-medium text-card-foreground">{t.trait.replace(/_/g, " ")}</span> · confidence{" "}
                {t.confidence.toFixed(2)} · supported by {t.supportingParents.join(", ")}
              </p>
            ))}
          </div>
        </details>

        {/* evidence */}
        <details className="rounded-md border bg-muted/20 p-2.5">
          <summary className="cursor-pointer text-xs font-medium text-card-foreground">
            View evidence ({parents.length} predecessor{parents.length === 1 ? "" : "s"})
          </summary>
          <div className="mt-2 space-y-2">
            {parents.length === 0 && <p className="text-[11px] text-muted-foreground">No predecessor evidence.</p>}
            {parents.map((p) => {
              const hp = historicalPolicyById(p.policyId);
              return (
                <div key={p.policyId} className="rounded-md border bg-card p-2.5">
                  <p className="text-xs font-medium text-card-foreground">
                    {p.name} — {p.channel} · {p.scale}-scale · evidence {p.evidenceStrength}
                  </p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">{p.reason}</p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    Similarity {p.overall.toFixed(2)} · shared mechanism tags:{" "}
                    {p.sharedTags.length ? p.sharedTags.join(", ") : "none"} · shared BN nodes:{" "}
                    {p.sharedNodes.length ? p.sharedNodes.join(", ") : "none"}
                  </p>
                  {hp && (
                    <>
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        Outcomes:{" "}
                        {hp.observedOutcomes
                          .map((o) => `${o.metric} — ${o.direction}${o.magnitude ? ` (${o.magnitude.value} ${o.magnitude.unit})` : ""}`)
                          .join("; ")}
                      </p>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        Sources: {hp.sources.map((s) => `${s.authority} — ${s.title}`).join("; ")}
                      </p>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        Comparability: {hp.comparability}
                      </p>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </details>

        {/* lineage */}
        <details className="rounded-md border bg-muted/20 p-2.5">
          <summary className="cursor-pointer text-xs font-medium text-card-foreground">
            View GGG lineage ({ggg.lineage.length} steps)
          </summary>
          <div className="mt-2 space-y-1">
            {ggg.lineage.map((l, i) => (
              <p key={`${l.step}-${i}`} className="text-[11px] leading-snug text-muted-foreground">
                <Network className="mr-1 inline h-3 w-3 opacity-70" />
                <span className="font-medium text-card-foreground">{l.step}</span> — {l.detail}
              </p>
            ))}
            <Separator className="my-1.5" />
            {ggg.grounded.rationale.map((r, i) => (
              <p key={i} className="text-[11px] text-muted-foreground">
                • {r}
              </p>
            ))}
          </div>
        </details>

        {ggg.notes.length > 0 && (
          <div className="space-y-1">
            {ggg.notes.map((n, i) => (
              <p key={i} className="flex items-start gap-1.5 text-[11px] text-warning">
                <Info className="mt-0.5 h-3 w-3 shrink-0" />
                {n}
              </p>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
