import { alertsData } from "@/lib/mockData";
import { AlertTriangle, Info, AlertCircle } from "lucide-react";

const icons = {
  warning: AlertTriangle,
  danger: AlertCircle,
  info: Info,
};

const colors = {
  warning: "border-warning/30 bg-warning/5",
  danger: "border-destructive/30 bg-destructive/5",
  info: "border-primary/30 bg-primary/5",
};

const iconColors = {
  warning: "text-warning",
  danger: "text-destructive",
  info: "text-primary",
};

export default function Alerts() {
  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <div className="animate-fade-up">
        <h1 className="text-2xl font-bold text-foreground">AI Alerts</h1>
        <p className="text-muted-foreground text-sm mt-1">Automated risk detection and data notifications.</p>
      </div>
      <div className="space-y-3">
        {alertsData.map((alert, i) => {
          const Icon = icons[alert.type];
          return (
            <div key={alert.id} className={`animate-fade-up stagger-${i + 1} rounded-lg border ${colors[alert.type]} p-4 flex items-start gap-3`}>
              <Icon className={`h-5 w-5 ${iconColors[alert.type]} mt-0.5 shrink-0`} />
              <div className="min-w-0 flex-1">
                <p className="font-medium text-sm text-foreground">{alert.title}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{alert.description}</p>
              </div>
              <span className="text-xs text-muted-foreground whitespace-nowrap">{alert.date}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
