"use client";

import { useState } from "react";
import { useSnapshot } from "valtio";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useUsageQuery } from "@/data/usage";
import type { UsageRange } from "@/lib/usage/aggregate";
import { cn } from "@/lib/utils";
import { usageUi, usageUiActions } from "@/stores/usageUi";
import { DayBars, SpendList } from "./SpendCharts";
import { WindowCard } from "./WindowCard";
import { formatUsd } from "./format";

const RANGES: { value: UsageRange; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
];

// The account's rolling windows, and what chats cost by day, session and
// workspace.
export function UsageDialog() {
  const { open } = useSnapshot(usageUi);
  const [range, setRange] = useState<UsageRange>("7d");
  const { data, isPending, isError, error } = useUsageQuery(range, open);
  const report = data?.report;

  return (
    <Dialog open={open} onOpenChange={usageUiActions.setOpen}>
      <DialogContent
        className="max-h-[90vh] max-w-xl overflow-y-auto"
        // Nothing to type in: no focus ring on the first range button.
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Usage</DialogTitle>
          <DialogDescription>
            The account&apos;s limits, and what chat sessions on this machine
            cost.
          </DialogDescription>
        </DialogHeader>

        <section className="grid grid-cols-2 gap-2">
          <WindowCard label="5-hour window" window={data?.windows.fiveHour} />
          <WindowCard label="Weekly window" window={data?.windows.sevenDay} />
          {data?.windows.note && (
            <p className="text-muted-foreground col-span-2 text-xs">
              {data.windows.note}
            </p>
          )}
        </section>

        <section className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-medium">Chat spend</h3>
            <div className="bg-foreground/[0.04] flex rounded-lg p-0.5">
              {RANGES.map((r) => (
                <button
                  key={r.value}
                  type="button"
                  onClick={() => setRange(r.value)}
                  aria-pressed={range === r.value}
                  className={cn(
                    "h-11 rounded-md px-3 text-xs md:h-8",
                    range === r.value
                      ? "bg-card text-foreground shadow-sm"
                      : "text-muted-foreground"
                  )}
                >
                  {r.label}
                </button>
              ))}
            </div>
          </div>

          {isError && (
            <p className="text-destructive text-sm">{String(error)}</p>
          )}
          {isPending && !report && (
            <div className="bg-foreground/[0.04] h-40 animate-pulse rounded-xl" />
          )}
          {report && (
            <>
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-semibold tabular-nums">
                  {formatUsd(report.total.costUsd)}
                </span>
                <span className="text-muted-foreground text-xs">
                  estimate · {report.total.turns} turns ·{" "}
                  {report.total.tokens.toLocaleString()} tokens
                </span>
              </div>
              {report.days.length > 1 && <DayBars days={report.days} />}
              <SpendList
                title="By workspace"
                rows={report.workspaces.map((w) => ({
                  key: w.id ?? "none",
                  label: w.name,
                  ...w,
                }))}
                total={report.total}
              />
              <SpendList
                title="By session"
                rows={report.sessions.map((s) => ({
                  key: s.id,
                  label: s.name,
                  ...s,
                }))}
                total={report.total}
                limit={10}
              />
              <p className="text-muted-foreground text-[11px]">
                Estimates at list prices from the agent&apos;s own counts,
                recorded from each chat turn as it ends. Terminal sessions
                aren&apos;t counted.
              </p>
            </>
          )}
        </section>
      </DialogContent>
    </Dialog>
  );
}
