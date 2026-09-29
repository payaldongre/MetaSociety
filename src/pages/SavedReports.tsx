import { FileText, Search } from "lucide-react";
import { Input } from "@/components/ui/input";

const reports = [
  { id: 1, title: "Q1 2026 Town Demographics Report", type: "insight", date: "Mar 20, 2026" },
  { id: 2, title: "Affordable Housing Subsidy – Simulation", type: "simulation", date: "Mar 19, 2026" },
  { id: 3, title: "Youth Employment Analysis", type: "insight", date: "Mar 15, 2026" },
  { id: 4, title: "Small Business Tax Relief – Simulation", type: "simulation", date: "Mar 12, 2026" },
];

export default function SavedReports() {
  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <div className="animate-fade-up">
        <h1 className="text-2xl font-bold text-foreground">Saved Reports</h1>
        <p className="text-muted-foreground text-sm mt-1">Access your saved insight and simulation reports.</p>
      </div>
      <div className="relative animate-fade-up stagger-1">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input placeholder="Search reports..." className="pl-9" />
      </div>
      <div className="space-y-2 animate-fade-up stagger-2">
        {reports.map((r) => (
          <div key={r.id} className="rounded-lg border bg-card p-4 flex items-center gap-3 hover:shadow-sm transition-shadow cursor-pointer">
            <FileText className="h-5 w-5 text-primary shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="font-medium text-sm text-card-foreground truncate">{r.title}</p>
              <p className="text-xs text-muted-foreground capitalize">{r.type} · {r.date}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
