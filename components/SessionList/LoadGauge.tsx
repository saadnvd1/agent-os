"use client";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { usageLabel, useMachineLoad } from "@/data/load";
import type { LoadView } from "@/lib/load/monitor";
import { cn } from "@/lib/utils";

const DOT: Record<LoadView["level"], string> = {
  green: "bg-green-500",
  amber: "bg-amber-500",
  red: "bg-destructive",
};

// "Load 4.2 on 10 cores · memory normal"
export function loadSummary(load: LoadView): string {
  const memory = load.pressure ?? `${load.memUsedPct}% used`;
  return `Load ${load.load1} on ${load.cores} cores · memory ${memory}`;
}

// The machine's load as a dot beside the workspace's name; tap it for the
// numbers and the sessions using the most CPU.
export function LoadGauge() {
  const load = useMachineLoad();
  if (!load) return null;
  const summary = loadSummary(load);
  const top = load.top.filter((s) => s.cores >= 0.1);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Machine load ${load.level}. ${summary}`}
          title={summary}
          className="h-11 w-8 shrink-0 md:h-8 md:w-6"
        >
          <span className={cn("h-2 w-2 rounded-full", DOT[load.level])} />
        </Button>
      </DropdownMenuTrigger>
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
