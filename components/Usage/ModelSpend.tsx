"use client";

import { useState } from "react";
import type { SpendByModel, TokenSpend } from "@/lib/usage/by-model";
import { ROLE_LABELS, isModelRole } from "@/lib/models/roles";
import { cn } from "@/lib/utils";
import { formatTokens, formatUsd } from "./format";

const roleLabel = (r: string) =>
  isModelRole(r) ? ROLE_LABELS[r].label : "Before routing";

// Tokens and estimated cost by role and by model, in the plan's 5-hour
// window or the last 24 hours.
export function ModelSpend({
  data,
}: {
  data: { fiveHour: SpendByModel; day: SpendByModel } | undefined;
}) {
  const [span, setSpan] = useState<"fiveHour" | "day">("fiveHour");
  if (!data) return null;
  const shown = data[span];
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium">By model and role</h3>
        <div className="bg-foreground/[0.04] flex rounded-lg p-0.5">
          {(
            [
              ["fiveHour", "5-hour window"],
              ["day", "24 hours"],
            ] as const
          ).map(([v, label]) => (
            <button
              key={v}
              type="button"
              onClick={() => setSpan(v)}
              aria-pressed={span === v}
              className={cn(
                "h-11 rounded-md px-3 text-xs md:h-8",
                span === v
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground"
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <SpendTable
        title="Role"
        rows={shown.roles.map((r) => ({
          key: r.role,
          label: roleLabel(r.role),
          ...r,
        }))}
        total={shown.total}
      />
      <SpendTable
        title="Model"
        rows={shown.models.map((m) => ({
          key: `${m.provider}/${m.model}`,
          label: `${m.provider}/${m.model}`,
          ...m,
        }))}
        total={shown.total}
      />
    </section>
  );
}

export function SpendTable({
  title,
  rows,
  total,
}: {
  title: string;
  rows: (TokenSpend & { key: string; label: string })[];
  total: TokenSpend;
}) {
  if (!rows.length)
    return <p className="text-muted-foreground text-xs">Nothing yet.</p>;
  const cell = "py-1.5 pr-2 text-right tabular-nums";
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead className="text-muted-foreground">
          <tr>
            <th className="py-1 pr-2 text-left font-normal">{title}</th>
            <th className={cn(cell, "font-normal")}>In</th>
            <th className={cn(cell, "font-normal")}>Out</th>
            <th className={cn(cell, "font-normal")}>Cache r/w</th>
            <th className={cn(cell, "font-normal")}>Turns</th>
            <th className={cn(cell, "font-normal")}>Est. cost</th>
          </tr>
        </thead>
        <tbody>
          {[...rows, { ...total, key: "__total", label: "Total" }].map((r) => (
            <tr
              key={r.key}
              className={cn(
                "border-border border-t",
                r.key === "__total" && "font-medium"
              )}
            >
              <td className="max-w-48 truncate py-1.5 pr-2 font-mono md:max-w-72">
                {r.label}
              </td>
              <td className={cell}>{formatTokens(r.inputTokens)}</td>
              <td className={cell}>{formatTokens(r.outputTokens)}</td>
              <td className={cell}>
                {formatTokens(r.cacheReadTokens)}/
                {formatTokens(r.cacheWriteTokens)}
              </td>
              <td className={cell}>{r.turns}</td>
              <td
                className={cell}
                title={
                  r.unpriced
                    ? "Partly the agent's own figure: not in the price table"
                    : undefined
                }
              >
                {formatUsd(r.costUsd)}
                {r.unpriced ? "*" : ""}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
