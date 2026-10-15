"use client";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { useHealthCount } from "@/data/health";
import { usageLabel, useMachineLoad } from "@/data/load";
import { settingsUiActions } from "@/stores/settingsUi";
import { loadSummary, statusDot, type DotLevel } from "./statusDot";
import { cn } from "@/lib/utils";

const DOT: Record<DotLevel, string> = {
  green: "bg-green-500",
  amber: "bg-amber-500",
  red: "bg-destructive",
};

const BUTTON_CLASS =
  "-ml-1.5 h-11 w-11 shrink-0 md:ml-0 md:h-8 md:w-6 [@media(hover:none)]:md:-ml-1.5 [@media(hover:none)]:md:h-11 [@media(hover:none)]:md:w-11";

// One dot beside the workspace's name for the machine's load and the health
// watch, whichever is worse. With a health issue open a tap goes to Settings
// → Health; otherwise it shows the load numbers and the busiest sessions.
export function LoadGauge() {
  const load = useMachineLoad();
  const { data: health } = useHealthCount();
  const dot = statusDot(load, health);
  if (!dot) return null;
  const button = (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={dot.label}
      title={dot.title}
      data-status-dot={dot.level}
      data-opens={dot.opensHealth ? "health" : "load"}
      onClick={
        dot.opensHealth ? () => settingsUiActions.open("health") : undefined
      }
      className={BUTTON_CLASS}
    >
      <span className={cn("h-2 w-2 rounded-full", DOT[dot.level])} />
    </Button>
  );
  if (dot.opensHealth || !load) return button;
  const summary = loadSummary(load);
  const top = load.top.filter((s) => s.cores >= 0.1);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{button}</DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72 p-3">
        <p className="text-sm font-medium">{summary}</p>
        {load.level !== "green" && (
          <p className="text-muted-foreground mt-1 text-xs">
            {load.level === "red"
              ? "Heavily loaded. Agents starting full suites or builds are told to narrow them or wait."
              : "Busy. Heavy commands are slowing each other down."}
          </p>
        )}
        {top.length > 0 && (
          <ul className="mt-3 space-y-2">
            {top.map((s) => (
              <li key={s.sessionId} className="flex min-w-0 flex-col">
                <span className="truncate text-sm">{s.name}</span>
                <span className="text-muted-foreground truncate text-xs">
                  {usageLabel(s)}
                  {s.heavy.length > 0 &&
                    ` · ${[...new Set(s.heavy)].join(", ")}`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
