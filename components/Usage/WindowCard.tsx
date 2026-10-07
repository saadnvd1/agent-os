"use client";

import { meterLevel } from "@/lib/chat/context";
import type { WindowView } from "@/lib/usage/windows";
import { cn } from "@/lib/utils";
import { formatDuration } from "./format";

const BAR = {
  ok: "bg-primary",
  warn: "bg-amber-500",
  high: "bg-destructive",
} as const;

export function WindowCard({
  label,
  window: w,
}: {
  label: string;
  window: WindowView | null | undefined;
}) {
  const level = w ? meterLevel(w.pct) : "ok";
  return (
    <div className="bg-foreground/[0.03] space-y-2 rounded-xl p-3">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-muted-foreground text-xs">{label}</span>
        <span className="text-lg font-semibold tabular-nums">
          {w ? `${w.pct}%` : "–"}
        </span>
      </div>
      <div className="bg-foreground/10 h-1.5 overflow-hidden rounded-full">
        <div
          className={cn("h-full rounded-full", BAR[level])}
          style={{ width: `${Math.min(w?.pct ?? 0, 100)}%` }}
        />
      </div>
      <p className="text-muted-foreground text-[11px]">
        {!w
          ? "Not available"
          : w.capsIn
            ? `Runs out in ${formatDuration(w.capsIn)} at this rate`
            : w.resetsIn !== null
              ? `Resets in ${formatDuration(w.resetsIn)}`
              : "Used"}
      </p>
    </div>
  );
}
