import { useState, useEffect } from "react";
import { Sun, Moon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export default function ThemeToggle() {
  const [isDark, setIsDark] = useState(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("meta_society_theme") === "dark";
    }
    return false;
  });
  const [isAnimating, setIsAnimating] = useState(false);

  useEffect(() => {
    const root = document.documentElement;
    if (isDark) {
      root.classList.add("dark");
    } else {
      root.classList.remove("dark");
    }
    localStorage.setItem("meta_society_theme", isDark ? "dark" : "light");
  }, [isDark]);

  const toggle = () => {
    setIsAnimating(true);
    setIsDark((prev) => !prev);
    setTimeout(() => setIsAnimating(false), 600);
  };

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          onClick={toggle}
          className="relative overflow-hidden rounded-full group"
          aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
        >
          <span
            className={`absolute inset-0 rounded-full bg-primary/10 transition-transform duration-300 scale-0 group-active:scale-150`}
          />
          <Sun
            className={`h-4 w-4 absolute transition-all duration-500 ease-in-out ${
              isDark
                ? "rotate-90 scale-0 opacity-0"
                : "rotate-0 scale-100 opacity-100"
            } ${isAnimating && !isDark ? "animate-bounce" : ""}`}
          />
          <Moon
            className={`h-4 w-4 absolute transition-all duration-500 ease-in-out ${
              isDark
                ? "rotate-0 scale-100 opacity-100"
                : "-rotate-90 scale-0 opacity-0"
            } ${isAnimating && isDark ? "animate-bounce" : ""}`}
          />
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        {isDark ? "Switch to Light Mode" : "Switch to Dark Mode"}
      </TooltipContent>
    </Tooltip>
  );
}
