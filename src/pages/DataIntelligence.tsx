import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { ArrowRight, Database, FileText, Upload } from "lucide-react";
import { toast } from "sonner";
import {
  incomeClassComposition,
  incomeDistribution,
  populationByAgeSex,
  provenanceCounts,
  sectorComposition,
  townFacts,
  townProfileParagraphs,
  workerStatusByAge,
  zoneComposition,
} from "@/lib/townData";

const COLORS = ["#3B82F6", "#10B981", "#F59E0B", "#EF4444", "#8B5CF6", "#6B7280"];
const PROVENANCE_STYLES: Record<string, string> = {
  census2011: "bg-success/12 text-success border-success/30",
  estimated: "bg-warning/12 text-warning border-warning/30",
  modelled: "bg-primary/12 text-primary border-primary/30",
  assumed: "bg-muted text-muted-foreground border-border",
};

export default function DataIntelligence() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // Population generation is deliberately not cheap (one agent per citizen);
    // defer it past first paint and show a loading state rather than blocking.
    const id = window.setTimeout(() => setReady(true), 0);
    return () => window.clearTimeout(id);
  }, []);

  const data = useMemo(() => {
    if (!ready) return null;
    return {
      ageSex: populationByAgeSex(),
      workerStatus: workerStatusByAge(),
      income: incomeDistribution(),
      sectors: sectorComposition(),
      incomeClasses: incomeClassComposition(),
      zones: zoneComposition(),
      facts: townFacts(),
      profile: townProfileParagraphs(),
      provenance: provenanceCounts(),
    };
  }, [ready]);

  const handleUpload = () => {
    toast.info("Dataset upload is not wired to a backend in this build. The charts below are generated from the built-in Census-anchored population.");
  };

  if (!data) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-foreground">Town Data Intelligence</h1>
        <div className="rounded-lg border bg-card p-10 text-center text-sm text-muted-foreground">
          Generating the citizen population…
        </div>
      </div>
    );
  }

  const { facts } = data;

  return (
    <div className="space-y-6">
      <div className="animate-fade-up">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-bold text-foreground">Town Data Intelligence</h1>
          <Badge variant="outline" className="border-primary/40 bg-primary/10 text-primary">
            <Database className="mr-1 h-3 w-3" /> Census-anchored, field-tagged
          </Badge>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Explore {facts.town} ({facts.district}) as the Simulation Lab sees it: one agent per citizen, generated from
          published Census 2011 totals. Every panel below states whether its field is measured or modelled.
        </p>
      </div>

      <div className="animate-fade-up stagger-1 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: "Population", value: facts.population.toLocaleString("en-IN") },
          { label: "Households", value: facts.households.toLocaleString("en-IN") },
          { label: "Wards", value: String(facts.wards) },
          { label: "Effective literacy", value: `${(facts.literacyRate * 100).toFixed(1)}%` },
        ].map((fact) => (
          <div key={fact.label} className="rounded-md border bg-card p-3">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{fact.label}</p>
            <p className="text-lg font-semibold text-card-foreground">{fact.value}</p>
          </div>
        ))}
      </div>

      <Tabs defaultValue="analytics" className="animate-fade-up stagger-2">
        <TabsList>
          <TabsTrigger value="analytics">Data Analytics</TabsTrigger>
          <TabsTrigger value="reports">Town Profile Report</TabsTrigger>
        </TabsList>

        <TabsContent value="analytics" className="mt-4 space-y-6">
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="outline" size="sm" onClick={handleUpload}>
              <Upload className="mr-1.5 h-4 w-4" />
              Upload Dataset
            </Button>
            <span className="text-xs text-muted-foreground">
              The built-in dataset is a single Census-2011 snapshot; there is no historical series to filter.
            </span>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-lg border bg-card p-4">
              <h3 className="mb-3 text-sm font-medium text-card-foreground">Population by Age Group</h3>
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={data.ageSex}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="group" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="male" fill="#3B82F6" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="female" fill="#EC4899" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="rounded-lg border bg-card p-4">
              <h3 className="mb-3 text-sm font-medium text-card-foreground">Worker Status by Age Band</h3>
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={data.workerStatus}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="group" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="main" name="Main worker" fill="#10B981" stackId="a" />
                  <Bar dataKey="marginal" name="Marginal worker" fill="#F59E0B" stackId="a" />
                  <Bar dataKey="nonWorker" name="Non-worker" fill="#6B7280" stackId="a" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="rounded-lg border bg-card p-4">
              <h3 className="mb-3 text-sm font-medium text-card-foreground">Household Income per Capita</h3>
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={data.income}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="bracket" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Bar dataKey="count" fill="#8B5CF6" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
              <p className="mt-2 text-[11px] text-muted-foreground">Income is modelled; the Census does not record it.</p>
            </div>

            <div className="rounded-lg border bg-card p-4">
              <h3 className="mb-3 text-sm font-medium text-card-foreground">Workers by Sector</h3>
              <ResponsiveContainer width="100%" height={240}>
                <PieChart>
                  <Pie
                    data={data.sectors}
                    cx="50%"
                    cy="50%"
                    outerRadius={80}
                    dataKey="share"
                    nameKey="sector"
                    label={({ sector, share }) => `${sector} ${share}%`}
                  >
                    {data.sectors.map((_, i) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </div>

            <div className="rounded-lg border bg-card p-4">
              <h3 className="mb-3 text-sm font-medium text-card-foreground">Population by Income Class</h3>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={data.incomeClasses}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="label" tick={{ fontSize: 9 }} interval={0} angle={-20} textAnchor="end" height={50} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Bar dataKey="count" fill="#3B82F6" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="rounded-lg border bg-card p-4">
              <h3 className="mb-3 text-sm font-medium text-card-foreground">Reporting Zones (partition of all wards)</h3>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={data.zones} layout="vertical" margin={{ left: 12, right: 24 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 11 }} />
                  <YAxis type="category" dataKey="zone" tick={{ fontSize: 11 }} width={60} />
                  <Tooltip />
                  <Bar dataKey="population" fill="#F59E0B" radius={[0, 3, 3, 0]} />
                </BarChart>
              </ResponsiveContainer>
              <p className="mt-2 text-[11px] text-muted-foreground">
                Zones are a reporting lens over wards, never simulated as four entities.
              </p>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="reports" className="mt-4 space-y-4">
          <div className="rounded-lg border bg-card p-6">
            <div className="mb-4 flex items-start gap-3">
              <FileText className="mt-0.5 h-6 w-6 text-primary" />
              <div>
                <h3 className="font-semibold text-card-foreground">Town Profile Report</h3>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  Written from the generated population by a deterministic template — not by a language model. Figures
                  are traceable to the generator below.
                </p>
              </div>
            </div>
            <div className="space-y-3 text-sm text-card-foreground/90">
              {data.profile.map((section) => (
                <p key={section.heading}>
                  <strong>{section.heading}:</strong> {section.body}
                </p>
              ))}
            </div>
          </div>

          <div className="rounded-lg border bg-card p-6">
            <h3 className="mb-3 font-semibold text-card-foreground">Provenance ledger</h3>
            <p className="mb-3 text-sm text-muted-foreground">
              Which fields are measured against published Census totals, and which are modelled or assumed. The same
              ledger is shown field by field in the Simulation Lab.
            </p>
            <div className="flex flex-wrap gap-2">
              {(["census2011", "estimated", "modelled", "assumed"] as const).map((tag) => (
                <Badge key={tag} variant="outline" className={PROVENANCE_STYLES[tag]}>
                  {tag} · {data.provenance[tag]}
                </Badge>
              ))}
            </div>
          </div>

          <Button asChild>
            <Link to="/ai-advisor">
              Ask the AI Policy Advisor for suggestions
              <ArrowRight className="ml-1.5 h-4 w-4" />
            </Link>
          </Button>
        </TabsContent>
      </Tabs>
    </div>
  );
}
