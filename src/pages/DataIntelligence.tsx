import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer, AreaChart, Area,
} from "recharts";
import {
  populationData, employmentTrend, incomeDistribution, economicSectors, costOfLivingIndex,
} from "@/lib/mockData";
import { Upload, Download, Share2, FileText, TrendingUp } from "lucide-react";
import { toast } from "sonner";

const COLORS = ["#3B82F6", "#10B981", "#F59E0B", "#EF4444", "#8B5CF6", "#6B7280"];

export default function DataIntelligence() {
  const [timeFilter, setTimeFilter] = useState("all");

  const handleUpload = () => {
    toast.info("File upload will be available with full backend integration. Using demo data for now.");
  };

  return (
    <div className="space-y-6">
      <div className="animate-fade-up">
        <h1 className="text-2xl font-bold text-foreground">Town Data Intelligence</h1>
        <p className="text-muted-foreground text-sm mt-1">Explore your community's data through interactive analytics and AI-generated reports.</p>
      </div>

      <Tabs defaultValue="analytics" className="animate-fade-up stagger-1">
        <TabsList>
          <TabsTrigger value="analytics">Data Analytics</TabsTrigger>
          <TabsTrigger value="reports">AI Insight Reports</TabsTrigger>
        </TabsList>

        <TabsContent value="analytics" className="space-y-6 mt-4">
          {/* Controls */}
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="outline" size="sm" onClick={handleUpload}>
              <Upload className="h-4 w-4 mr-1.5" />Upload Dataset
            </Button>
            <Select value={timeFilter} onValueChange={setTimeFilter}>
              <SelectTrigger className="w-36 h-9"><SelectValue placeholder="Time Period" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Time</SelectItem>
                <SelectItem value="2024">2024</SelectItem>
                <SelectItem value="2023">2023</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Charts Grid */}
          <div className="grid gap-4 md:grid-cols-2">
            {/* Population Distribution */}
            <div className="rounded-lg border bg-card p-4">
              <h3 className="font-medium text-sm text-card-foreground mb-3">Population by Age Group</h3>
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={populationData}>
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

            {/* Employment Trend */}
            <div className="rounded-lg border bg-card p-4">
              <h3 className="font-medium text-sm text-card-foreground mb-3">Employment Trend (%)</h3>
              <ResponsiveContainer width="100%" height={240}>
                <LineChart data={employmentTrend}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="year" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} domain={[75, 100]} />
                  <Tooltip />
                  <Legend />
                  <Line type="monotone" dataKey="employed" stroke="#10B981" strokeWidth={2} dot={{ r: 3 }} />
                  <Line type="monotone" dataKey="unemployed" stroke="#EF4444" strokeWidth={2} dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>

            {/* Income Distribution */}
            <div className="rounded-lg border bg-card p-4">
              <h3 className="font-medium text-sm text-card-foreground mb-3">Income Distribution</h3>
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={incomeDistribution}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="bracket" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Bar dataKey="count" fill="#8B5CF6" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Economic Sectors */}
            <div className="rounded-lg border bg-card p-4">
              <h3 className="font-medium text-sm text-card-foreground mb-3">Economic Sectors</h3>
              <ResponsiveContainer width="100%" height={240}>
                <PieChart>
                  <Pie data={economicSectors} cx="50%" cy="50%" outerRadius={80} dataKey="share" label={({ sector, share }) => `${sector} ${share}%`}>
                    {economicSectors.map((_, i) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </div>

            {/* Cost of Living */}
            <div className="rounded-lg border bg-card p-4 md:col-span-2">
              <h3 className="font-medium text-sm text-card-foreground mb-3">Cost of Living Index (Base 2020 = 100)</h3>
              <ResponsiveContainer width="100%" height={200}>
                <AreaChart data={costOfLivingIndex}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="year" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} domain={[95, 130]} />
                  <Tooltip />
                  <Area type="monotone" dataKey="index" stroke="#F59E0B" fill="#F59E0B" fillOpacity={0.15} strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="reports" className="mt-4 space-y-4">
          <div className="rounded-lg border bg-card p-6">
            <div className="flex items-start gap-3 mb-4">
              <FileText className="h-6 w-6 text-primary mt-0.5" />
              <div>
                <h3 className="font-semibold text-card-foreground">AI-Generated Narrative Report</h3>
                <p className="text-sm text-muted-foreground mt-0.5">Based on current demo dataset · Generated March 23, 2026</p>
              </div>
            </div>
            <div className="prose prose-sm max-w-none text-card-foreground/90 space-y-3">
              <p>
                <strong>Population Overview:</strong> The town has a working-age population of approximately 29,000 residents,
                with the 25-34 age group representing the largest demographic segment. Gender distribution is relatively balanced
                with a slight female majority in older age brackets.
              </p>
              <p>
                <strong>Employment Trends:</strong> After a significant dip during 2020 (employment fell to 82.1%),
                the labor market has shown steady recovery. Current employment stands at 90.4%, nearing pre-pandemic levels.
                However, unemployment among low-income workers aged 18-24 remains elevated at 14.2%.
              </p>
              <p>
                <strong>Housing & Cost of Living:</strong> The cost of living index has risen 22.1% since 2020.
                Urban housing demand exceeds supply by approximately 25%, likely pushing rents up 8-15% over the next year.
                Middle-income households ($40-60k) face the greatest affordability pressure.
              </p>
              <p>
                <strong>Key Risk:</strong> If current trends continue, youth unemployment could exceed 18% by Q3 2025,
                and the housing gap may widen further without policy intervention.
              </p>
            </div>
            <div className="flex gap-2 mt-5">
              <Button size="sm" variant="outline" onClick={() => toast.success("Report saved to library")}>
                <Download className="h-3.5 w-3.5 mr-1.5" />Save
              </Button>
              <Button size="sm" variant="outline" onClick={() => toast.info("Share link copied")}>
                <Share2 className="h-3.5 w-3.5 mr-1.5" />Share
              </Button>
            </div>
          </div>

          <Button onClick={() => toast.info("AI report generation will use Lovable AI. Using demo report for now.")}>
            <TrendingUp className="h-4 w-4 mr-1.5" />Generate New Report
          </Button>
        </TabsContent>
      </Tabs>
    </div>
  );
}
