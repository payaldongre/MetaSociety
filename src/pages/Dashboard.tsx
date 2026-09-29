import { Link } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { BarChart3, Bot, FlaskConical, AlertTriangle, TrendingUp, Clock } from "lucide-react";
import { alertsData, recentSimulations } from "@/lib/mockData";

const sections = [
  {
    title: "Town Data Intelligence",
    description: "Upload datasets, explore interactive visualizations, and generate AI-powered insight reports on demographics, employment, and economics.",
    icon: BarChart3,
    path: "/data-intelligence",
    color: "text-primary",
    bg: "bg-primary/5 hover:bg-primary/10",
    border: "border-primary/20",
  },
  {
    title: "AI Policy Advisor",
    description: "Describe your policy goals in plain language. Get AI-generated suggestions with benefits, risks, and affected groups.",
    icon: Bot,
    path: "/ai-advisor",
    color: "text-success",
    bg: "bg-success/5 hover:bg-success/10",
    border: "border-success/20",
  },
  {
    title: "Policy Simulation Lab",
    description: "Configure and run policy simulations. Compare scenarios with economic and social impact metrics in real time.",
    icon: FlaskConical,
    path: "/simulation-lab",
    color: "text-warning",
    bg: "bg-warning/5 hover:bg-warning/10",
    border: "border-warning/20",
  },
];

export default function Dashboard() {
  const { user } = useAuth();
  const firstName = user?.fullName?.split(" ")[0] || "there";

  return (
    <div className="space-y-8">
      <section className="animate-fade-up">
        <h1 className="text-2xl sm:text-3xl font-bold text-foreground text-balance leading-tight">
          Welcome back, {firstName}
        </h1>
        <p className="text-muted-foreground mt-1 max-w-2xl">
          Understand, advise, and simulate policies for your community.
        </p>
      </section>

      {alertsData.length > 0 && (
        <div className="animate-fade-up stagger-1 flex items-start gap-3 rounded-lg border border-warning/30 bg-warning/5 p-4">
          <AlertTriangle className="h-5 w-5 text-warning mt-0.5 shrink-0" />
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground">{alertsData[0].title}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{alertsData[0].description}</p>
          </div>
          <Link to="/alerts" className="text-xs text-primary font-medium whitespace-nowrap hover:underline ml-auto">
            View all
          </Link>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {sections.map((s, i) => (
          <Link
            key={s.path}
            to={s.path}
            className={`animate-fade-up stagger-${i + 1} group rounded-lg border ${s.border} ${s.bg} p-6 transition-all duration-300 hover:shadow-md active:scale-[0.98]`}
          >
            <s.icon className={`h-8 w-8 ${s.color} mb-3`} />
            <h2 className="font-semibold text-foreground text-lg">{s.title}</h2>
            <p className="text-sm text-muted-foreground mt-1.5 leading-relaxed">{s.description}</p>
          </Link>
        ))}
      </div>

      <section className="animate-fade-up stagger-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold text-foreground flex items-center gap-2">
            <Clock className="h-4 w-4 text-muted-foreground" />
            Recent Simulations
          </h2>
          <Link to="/simulation-lab" className="text-sm text-primary hover:underline">View all</Link>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {recentSimulations.map((sim) => (
            <div key={sim.id} className="rounded-lg border bg-card p-4 hover:shadow-sm transition-shadow">
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-medium text-sm text-card-foreground">{sim.name}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{sim.type} · {sim.date}</p>
                </div>
                <div className="flex items-center gap-1">
                  <TrendingUp className="h-3.5 w-3.5 text-success" />
                  <span className="text-sm font-semibold text-success">{sim.score}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
