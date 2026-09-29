import { Link, useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import ThemeToggle from "@/components/ThemeToggle";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Building2, Bell, FileText, Activity, User, Settings, LogOut } from "lucide-react";
import { cn } from "@/lib/utils";

const navLinks = [
  { label: "Dashboard", path: "/" },
  { label: "Town Data", path: "/data-intelligence" },
  { label: "AI Advisor", path: "/ai-advisor" },
  { label: "Simulation Lab", path: "/simulation-lab" },
];

export default function TopNav() {
  const { user, signOut } = useAuth();
  const location = useLocation();

  return (
    <header className="sticky top-0 z-50 border-b bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/80 transition-colors duration-500">
      <div className="container flex h-14 items-center justify-between">
        <div className="flex items-center gap-6">
          <Link to="/" className="flex items-center gap-2 font-bold text-foreground">
            <Building2 className="h-6 w-6 text-primary" />
            <span className="hidden sm:inline">Meta Society</span>
          </Link>
          <nav className="hidden md:flex items-center gap-1">
            {navLinks.map((link) => (
              <Link
                key={link.path}
                to={link.path}
                className={cn(
                  "px-3 py-1.5 rounded-md text-sm font-medium transition-colors",
                  location.pathname === link.path
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:text-foreground hover:bg-accent"
                )}
              >
                {link.label}
              </Link>
            ))}
          </nav>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" className="relative" asChild>
            <Link to="/alerts">
              <Bell className="h-4 w-4" />
              <span className="absolute -top-0.5 -right-0.5 h-3.5 w-3.5 rounded-full bg-destructive text-[9px] text-destructive-foreground flex items-center justify-center font-bold">3</span>
            </Link>
          </Button>
          <Button variant="ghost" size="icon" className="hidden sm:flex" asChild>
            <Link to="/saved-reports"><FileText className="h-4 w-4" /></Link>
          </Button>
          <Button variant="ghost" size="icon" className="hidden sm:flex" asChild>
            <Link to="/simulation-lab"><Activity className="h-4 w-4" /></Link>
          </Button>

          <ThemeToggle />

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="rounded-full">
                <User className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <div className="px-2 py-1.5 text-sm font-medium truncate">
                {user?.email}
              </div>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <Link to="/profile" className="cursor-pointer"><Settings className="mr-2 h-4 w-4" />Profile & Settings</Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link to="/saved-reports" className="cursor-pointer"><FileText className="mr-2 h-4 w-4" />Saved Reports</Link>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={signOut} className="cursor-pointer text-destructive">
                <LogOut className="mr-2 h-4 w-4" />Sign Out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  );
}
