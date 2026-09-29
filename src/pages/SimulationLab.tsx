import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import { simulationMetrics } from "@/lib/mockData";
import { FlaskConical, Play, Download, Save, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { toast } from "sonner";

export default function SimulationLab() {
  const [policyType, setPolicyType] = useState("tax");
  const [policyName, setPolicyName] = useState("");
  const [duration, setDuration] = useState([12]);
  const [budget, setBudget] = useState([50]);
  const [running, setRunning] = useState(false);
  const [showResults, setShowResults] = useState(false);

  const runSimulation = () => {
    if (!policyName.trim()) {
      toast.error("Please enter a policy name");
      return;
    }
    setRunning(true);
    setShowResults(false);
    // Fake delay
    setTimeout(() => {
      setRunning(false);
      setShowResults(true);
      toast.success("Simulation complete!");
    }, 3000);
  };

  const summaryMetrics = [
    { label: "GDP Growth", value: "+1.0%", change: "up" },
    { label: "Employment", value: "+3.2%", change: "up" },
    { label: "Happiness", value: "+11 pts", change: "up" },
    { label: "Inflation", value: "+0.2%", change: "neutral" },
    { label: "Gini Index", value: "-0.03", change: "up" },
    { label: "Protest Risk", value: "Low", change: "up" },
  ];

  return (
    <div className="space-y-6">
      <div className="animate-fade-up">
        <h1 className="text-2xl font-bold text-foreground">Policy Simulation Lab</h1>
        <p className="text-muted-foreground text-sm mt-1">Configure policies, run simulations, and compare outcomes.</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
        {/* Config Panel */}
        <div className="animate-fade-up stagger-1 rounded-lg border bg-card p-5 space-y-5 h-fit">
          <h2 className="font-semibold text-card-foreground flex items-center gap-2">
            <FlaskConical className="h-4 w-4 text-primary" />Configuration
          </h2>

          <div className="space-y-3">
            <div>
              <Label className="text-xs">Policy Name</Label>
              <Input placeholder="e.g., Youth Employment Act" className="mt-1 h-9"
                value={policyName} onChange={(e) => setPolicyName(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Policy Type</Label>
              <Select value={policyType} onValueChange={setPolicyType}>
                <SelectTrigger className="mt-1 h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="tax">Tax Change</SelectItem>
                  <SelectItem value="subsidy">Subsidy</SelectItem>
                  <SelectItem value="regulation">Regulation</SelectItem>
                  <SelectItem value="housing">Housing</SelectItem>
                  <SelectItem value="labor">Labor Market</SelectItem>
                  <SelectItem value="education">Education</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Duration: {duration[0]} months</Label>
              <Slider value={duration} onValueChange={setDuration} min={3} max={60} step={3} className="mt-2" />
            </div>
            <div>
              <Label className="text-xs">Budget: ${budget[0]}M</Label>
              <Slider value={budget} onValueChange={setBudget} min={1} max={200} step={5} className="mt-2" />
            </div>
          </div>

          <Button onClick={runSimulation} disabled={running} className="w-full">
            {running ? (
              <span className="flex items-center gap-2">
                <span className="h-4 w-4 rounded-full border-2 border-primary-foreground border-t-transparent animate-spin" />
                Running...
              </span>
            ) : (
              <><Play className="h-4 w-4 mr-1.5" />Run Simulation</>
            )}
          </Button>
        </div>

        {/* Results */}
        <div className="space-y-4 animate-fade-up stagger-2">
          {!showResults && !running && (
            <div className="rounded-lg border bg-card p-12 flex flex-col items-center justify-center text-center">
              <FlaskConical className="h-16 w-16 text-muted-foreground/20 mb-4" />
              <p className="text-muted-foreground text-sm">Configure your policy and click "Run Simulation" to see projected outcomes.</p>
            </div>
          )}

          {running && (
            <div className="rounded-lg border bg-card p-12 flex flex-col items-center justify-center text-center">
              <div className="h-12 w-12 rounded-full border-3 border-primary border-t-transparent animate-spin mb-4" />
              <p className="text-sm font-medium text-card-foreground">Running simulation...</p>
              <p className="text-xs text-muted-foreground mt-1">Calculating economic and social impacts for {duration[0]} months</p>
            </div>
          )}

          {showResults && (
            <>
              {/* Summary Metrics */}
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                {summaryMetrics.map((m) => (
                  <div key={m.label} className="rounded-lg border bg-card p-3 text-center">
                    <p className="text-xs text-muted-foreground">{m.label}</p>
                    <div className="flex items-center justify-center gap-1 mt-1">
                      {m.change === "up" && <TrendingUp className="h-3.5 w-3.5 text-success" />}
                      {m.change === "neutral" && <Minus className="h-3.5 w-3.5 text-warning" />}
                      {m.change === "down" && <TrendingDown className="h-3.5 w-3.5 text-destructive" />}
                      <span className="font-semibold text-sm text-card-foreground">{m.value}</span>
                    </div>
                  </div>
                ))}
              </div>

              {/* Charts */}
              <div className="grid gap-4 md:grid-cols-2">
                {(["gdp", "employment", "happiness", "inflation"] as const).map((key) => {
                  const titles: Record<string, string> = {
                    gdp: "GDP Growth (%)", employment: "Employment Rate (%)",
                    happiness: "Happiness Index", inflation: "Inflation Rate (%)",
                  };
                  return (
                    <div key={key} className="rounded-lg border bg-card p-4">
                      <h3 className="font-medium text-sm text-card-foreground mb-3">{titles[key]}</h3>
                      <ResponsiveContainer width="100%" height={200}>
                        <LineChart data={simulationMetrics[key]}>
                          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                          <XAxis dataKey="month" tick={{ fontSize: 10 }} />
                          <YAxis tick={{ fontSize: 10 }} />
                          <Tooltip />
                          <Legend />
                          <Line type="monotone" dataKey="baseline" stroke="#9CA3AF" strokeWidth={1.5} strokeDasharray="4 4" dot={{ r: 2 }} name="Baseline" />
                          <Line type="monotone" dataKey="simulated" stroke="#3B82F6" strokeWidth={2} dot={{ r: 3 }} name="Simulated" />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  );
                })}
              </div>

              {/* Actions */}
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => toast.success("Report saved")}>
                  <Save className="h-3.5 w-3.5 mr-1.5" />Save Report
                </Button>
                <Button size="sm" variant="outline" onClick={() => toast.info("Export feature coming soon")}>
                  <Download className="h-3.5 w-3.5 mr-1.5" />Export
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
