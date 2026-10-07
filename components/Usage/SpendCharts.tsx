"use client";

import type { Spend, UsageReport } from "@/lib/usage/aggregate";
import { formatUsd } from "./format";

// One bar per day of the range, tallest the most expensive.
export function DayBars({ days }: { days: UsageReport["days"] }) {
  const max = Math.max(...days.map((d) => d.costUsd), 0);
  return (
    <div>
      <div className="flex h-28 items-end gap-[3px]">
        {days.map((d) => (
          <div
            key={d.date}
            className="group relative flex h-full flex-1 items-end"
            title={`${d.date}: ${formatUsd(d.costUsd)}, ${d.turns} turns`}
          >
            <div
              className="bg-primary/70 group-hover:bg-primary w-full rounded-t-[3px]"
              style={{
                height: `${max > 0 ? Math.max((d.costUsd / max) * 100, d.costUsd > 0 ? 2 : 0) : 0}%`,
              }}
            />
          </div>
        ))}
      </div>
      <div className="text-muted-foreground mt-1 flex justify-between text-[10px] tabular-nums">
        <span>{days[0].date.slice(5)}</span>
        <span>{days[days.length - 1].date.slice(5)}</span>
      </div>
    </div>
  );
}

// Rows with a bar for their share of the total, and the total at the foot.
export function SpendList({
  title,
  rows,
  total,
  limit,
}: {
  title: string;
  rows: (Spend & { key: string; label: string })[];
  total: Spend;
  limit?: number;
}) {
  if (!rows.length) return null;
  const shown = limit ? rows.slice(0, limit) : rows;
  const rest = rows.slice(shown.length);
  const restCost = rest.reduce((sum, r) => sum + r.costUsd, 0);
  return (
    <div className="space-y-1.5">
      <h4 className="text-muted-foreground text-xs font-medium">{title}</h4>
      <ul className="space-y-1">
        {shown.map((r) => (
          <li key={r.key} className="space-y-0.5">
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="min-w-0 truncate">{r.label}</span>
              <span className="shrink-0 tabular-nums">
                {formatUsd(r.costUsd)}
              </span>
            </div>
            <div className="bg-foreground/[0.06] h-1 overflow-hidden rounded-full">
              <div
                className="bg-primary/60 h-full rounded-full"
                style={{
                  width: `${total.costUsd > 0 ? (r.costUsd / total.costUsd) * 100 : 0}%`,
                }}
              />
            </div>
          </li>
        ))}
        {rest.length > 0 && (
          <li className="text-muted-foreground flex justify-between text-xs">
            <span>{rest.length} more</span>
            <span className="tabular-nums">{formatUsd(restCost)}</span>
          </li>
        )}
      </ul>
      <div className="border-foreground/[0.06] flex justify-between border-t pt-1.5 text-xs font-medium">
        <span>Total</span>
        <span className="tabular-nums">{formatUsd(total.costUsd)}</span>
      </div>
    </div>
  );
}
