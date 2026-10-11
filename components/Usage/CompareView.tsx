"use client";

import { useState } from "react";
import { useCompareQuery } from "@/data/models";
import type { Cohort, Comparison } from "@/lib/usage/compare";
import { ROLE_LABELS, isModelRole } from "@/lib/models/roles";
import { cn } from "@/lib/utils";
import { formatPct, formatTokens, formatUsd } from "./format";
import { SpendTable } from "./ModelSpend";
import { emptySpend, sumSpend } from "@/lib/usage/by-model";

const RANGES = [7, 30, 90] as const;

const per = (n: number, tasks: number) => (tasks ? n / tasks : 0);
const minutes = (ms: number) => `${Math.round(ms / 60000)}m`;

const totalCohort = (cs: Cohort[]): Cohort =>
  cs.reduce<Cohort>(
    (t, c) => ({
      ...t,
      tasks: t.tasks + c.tasks,
      spend: sumSpend([t.spend, c.spend]),
      planPct: t.planPct + c.planPct,
      wallMs: t.wallMs + c.wallMs,
      ciFirstGreen: add(t.ciFirstGreen, c.ciFirstGreen),
      reviewFirstPass: add(t.reviewFirstPass, c.reviewFirstPass),
      gateFailures: t.gateFailures + c.gateFailures,
      rework: t.rework + c.rework,
      merged: add(t.merged, c.merged),
      dropped: add(t.dropped, c.dropped),
    }),
    {
      key: "Total",
      baseline: false,
      tasks: 0,
      smallSample: false,
      spend: emptySpend(),
      planPct: 0,
      wallMs: 0,
      ciFirstGreen: { yes: 0, of: 0 },
      reviewFirstPass: { yes: 0, of: 0 },
      gateFailures: 0,
      rework: 0,
      merged: { yes: 0, of: 0 },
      dropped: { yes: 0, of: 0 },
    }
  );

function add(a: { yes: number; of: number }, b: { yes: number; of: number }) {
  return { yes: a.yes + b.yes, of: a.of + b.of };
}

const ROWS: { label: string; value: (c: Cohort) => string }[] = [
  { label: "Tasks", value: (c) => String(c.tasks) },
  { label: "Turns", value: (c) => String(c.spend.turns) },
  {
    label: "Tokens",
    value: (c) =>
      formatTokens(
        c.spend.inputTokens +
          c.spend.outputTokens +
          c.spend.cacheReadTokens +
          c.spend.cacheWriteTokens
      ),
  },
  { label: "Est. cost", value: (c) => formatUsd(c.spend.costUsd) },
  {
    label: "Cost per task",
    value: (c) => formatUsd(per(c.spend.costUsd, c.tasks)),
  },
  {
    label: "Claude window per task",
    value: (c) =>
      c.planPct ? `${per(c.planPct, c.tasks).toFixed(1)} pts` : "—",
  },
  {
    label: "Agent time per task",
    value: (c) => minutes(per(c.wallMs, c.tasks)),
  },
  {
    label: "CI green on first push",
    value: (c) => formatPct(c.ciFirstGreen.yes, c.ciFirstGreen.of),
  },
  {
    label: "Review passed first try",
    value: (c) => formatPct(c.reviewFirstPass.yes, c.reviewFirstPass.of),
  },
  {
    label: "Gate failures per task",
    value: (c) => per(c.gateFailures, c.tasks).toFixed(1),
  },
  {
    label: "Rework commits per task",
    value: (c) => per(c.rework, c.tasks).toFixed(1),
  },
  { label: "Merged", value: (c) => formatPct(c.merged.yes, c.merged.of) },
  { label: "Dropped", value: (c) => formatPct(c.dropped.yes, c.dropped.of) },
];

// Claude-only tasks against routed ones, side by side, over a date range.
export function CompareView({ enabled }: { enabled: boolean }) {
  const [days, setDays] = useState<number>(30);
  const { data, isPending, isError, error } = useCompareQuery(days, enabled);
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium">Before and after routing</h3>
        <div className="bg-foreground/[0.04] flex rounded-lg p-0.5">
          {RANGES.map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setDays(d)}
              aria-pressed={days === d}
              className={cn(
                "h-11 rounded-md px-3 text-xs md:h-8",
                days === d
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground"
              )}
            >
              {d} days
            </button>
          ))}
        </div>
      </div>
      {isError && <p className="text-destructive text-sm">{error.message}</p>}
      {isPending && !data && (
        <div className="bg-foreground/[0.04] h-40 animate-pulse rounded-xl" />
      )}
      {data && <CompareTables data={data} />}
    </section>
  );
}

function CompareTables({ data }: { data: Comparison }) {
  if (!data.cohorts.length)
    return (
      <p className="text-muted-foreground text-xs">
        No tasks ran in this range.
      </p>
    );
  const columns = [...data.cohorts, totalCohort(data.cohorts)];
  const cell = "py-1.5 pr-2 text-right tabular-nums";
  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr>
              <th className="py-1 pr-2 text-left font-normal" />
              {columns.map((c) => (
                <th
                  key={c.key}
                  className={cn(cell, "align-bottom font-medium")}
                >
                  <span className="font-mono">{c.key}</span>
                  {c.baseline && (
                    <span className="text-muted-foreground block font-normal">
                      baseline
                    </span>
                  )}
                  {c.smallSample && (
                    <span className="block font-normal text-amber-600 dark:text-amber-400">
                      small sample
                    </span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ROWS.map((row) => (
              <tr key={row.label} className="border-border border-t">
                <td className="text-muted-foreground py-1.5 pr-2">
                  {row.label}
                </td>
                {columns.map((c) => (
                  <td
                    key={c.key}
                    className={cn(cell, c.key === "Total" && "font-medium")}
                  >
                    {row.value(c)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <SpendTable
        title="Role · model"
        rows={data.roles.map((r) => ({
          ...r,
          key: `${r.role} ${r.provider}/${r.model}`,
          label: `${isModelRole(r.role) ? ROLE_LABELS[r.role].label : "Before routing"} · ${r.provider}/${r.model}`,
        }))}
        total={sumSpend(data.roles)}
      />
      <p className="text-muted-foreground text-[11px]">
        A task counts under the provider its own turns ran on (anthropic is the
        baseline); its reviews and checks count toward its cost. Dollars are
        list-price estimates; for Claude, the plan&apos;s real measure is its
        5-hour window, shared out by how far each turn moved it (an estimate).
        Outcomes come from the orchestrator&apos;s checks, so only its tasks
        have them. Under 10 tasks a column is a small sample: read it as a hint,
        not a result.
      </p>
    </>
  );
}
