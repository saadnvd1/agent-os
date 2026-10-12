"use client";

import { useUsageRollupsQuery, type RollupsResponse } from "@/data/usage";
import type { Rollup } from "@/lib/usage/span";
import { spanOf } from "@/lib/usage/span";
import { cn } from "@/lib/utils";
import { formatTokens } from "./format";

const pct = (n: number | null, digits = 0) =>
  n === null ? "—" : `${(n * 100).toFixed(digits)}%`;
const tok = (n: number | null) => (n === null ? "—" : formatTokens(n));
const num = (n: number | null) => (n === null ? "—" : n.toFixed(1));

interface Cell {
  key: string;
  label: string;
  value: (r: Rollup) => string;
}

// Rollups store sums, so each ratio is worked out from one day's.
const COLS: Cell[] = [
  { key: "w", label: "Weighted", value: (r) => tok(r.weighted) },
  { key: "m", label: "Merged", value: (r) => String(r.merged) },
  { key: "c", label: "Clean", value: (r) => String(r.clean) },
  {
    key: "cpm",
    label: "Per merged",
    value: (r) => tok(spanOf([r]).costPerMerged),
  },
  {
    key: "cpc",
    label: "Per clean",
    value: (r) => tok(spanOf([r]).costPerClean),
  },
  {
    key: "rev",
    label: "Review / PR",
    value: (r) => tok(spanOf([r]).reviewPerPr),
  },
  {
    key: "ctx",
    label: ">200k",
    value: (r) => pct(spanOf([r]).over200kShare),
  },
  {
    key: "orch",
    label: "Orch.",
    value: (r) => pct(spanOf([r]).orchestratorShare),
  },
  { key: "opus", label: "Opus", value: (r) => pct(spanOf([r]).opusShare) },
  {
    key: "wk",
    label: "Week %",
    value: (r) =>
      r.weeklyPct === null
        ? "—"
        : `${r.weeklyEstimated ? "~" : ""}${Math.round(r.weeklyPct)}`,
  },
  {
    key: "fix",
    label: "Fix rds",
    value: (r) => num(spanOf([r]).fixRoundsPerPr),
  },
  { key: "esc", label: "Escal.", value: (r) => String(r.escalations) },
  { key: "scope", label: "Scope", value: (r) => String(r.scopeChanges) },
  {
    key: "escp",
    label: "Escapes",
    value: (r) => (r.escapes === null ? "—" : String(r.escapes)),
  },
];

function totalRow(rows: Rollup[]): Record<string, string> {
  const s = spanOf(rows);
  return {
    w: tok(s.weighted),
    m: String(s.merged),
    c: String(s.clean),
    cpm: tok(s.costPerMerged),
    cpc: tok(s.costPerClean),
    rev: tok(s.reviewPerPr),
    ctx: pct(s.over200kShare),
    orch: pct(s.orchestratorShare),
    opus: pct(s.opusShare),
    wk: "",
    fix: num(s.fixRoundsPerPr),
    esc: String(s.escalations),
    scope: String(s.scopeChanges),
    escp: s.escapes === null ? "—" : String(s.escapes),
  };
}

// Daily usage and quality, the ratchet's baseline, and the open alerts.
export function RatchetView({ enabled }: { enabled: boolean }) {
  const { data, isPending, isError, error } = useUsageRollupsQuery(enabled);
  if (isError)
    return <p className="text-destructive text-sm">{String(error)}</p>;
  if (isPending || !data)
    return (
      <div className="bg-foreground/[0.04] h-40 animate-pulse rounded-xl" />
    );
  const rows = [...data.rollups].reverse();
  const total = totalRow(data.rollups);
  return (
    <section className="min-w-0 space-y-4">
      {data.alerts.map((a) => (
        <p
          key={a.kind}
          role="alert"
          className="bg-destructive/10 text-destructive rounded-xl p-3 text-xs"
        >
          {a.message}
        </p>
      ))}
      <BaselineCard data={data} />
      {rows.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          No rollups yet. The first runs shortly after midnight.
        </p>
      ) : (
        <>
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full text-xs tabular-nums">
              <thead className="text-muted-foreground">
                <tr>
                  <th className="bg-card sticky left-0 py-1.5 pr-2 text-left font-normal whitespace-nowrap">
                    Day
                  </th>
                  {COLS.map((c) => (
                    <th
                      key={c.key}
                      className="px-2 py-1.5 text-right font-normal"
                    >
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr className="border-foreground/10 border-y font-medium">
                  <td className="bg-card sticky left-0 py-1.5 pr-2 whitespace-nowrap">
                    {rows.length} days
                  </td>
                  {COLS.map((c) => (
                    <td key={c.key} className="px-2 py-1.5 text-right">
                      {total[c.key]}
                    </td>
                  ))}
                </tr>
                {rows.map((r) => (
                  <tr key={r.day} className="border-foreground/5 border-b">
                    <td className="bg-card sticky left-0 py-1.5 pr-2 whitespace-nowrap">
                      {r.day.slice(5)}
                    </td>
                    {COLS.map((c) => (
                      <td key={c.key} className="px-2 py-1.5 text-right">
                        {c.value(r)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="space-y-2 md:hidden">
            <li className="bg-foreground/[0.06] rounded-xl p-3">
              <div className="flex items-baseline justify-between">
                <span className="text-sm font-medium">{rows.length} days</span>
                <span className="tabular-nums">{total.w} weighted</span>
              </div>
              <dl className="mt-2 grid grid-cols-3 gap-x-3 gap-y-1.5 text-[11px]">
                {COLS.slice(1)
                  .filter((c) => c.key !== "wk")
                  .map((c) => (
                    <div key={c.key}>
                      <dt className="text-muted-foreground">{c.label}</dt>
                      <dd className="tabular-nums">{total[c.key]}</dd>
                    </div>
                  ))}
              </dl>
            </li>
            {rows.map((r) => (
              <li key={r.day} className="bg-foreground/[0.03] rounded-xl p-3">
                <div className="flex items-baseline justify-between">
                  <span className="text-sm font-medium">{r.day.slice(5)}</span>
                  <span className="tabular-nums">
                    {tok(r.weighted)} weighted
                  </span>
                </div>
                <dl className="mt-2 grid grid-cols-3 gap-x-3 gap-y-1.5 text-[11px]">
                  {COLS.slice(1).map((c) => (
                    <div key={c.key}>
                      <dt className="text-muted-foreground">{c.label}</dt>
                      <dd className="tabular-nums">{c.value(r)}</dd>
                    </div>
                  ))}
                </dl>
              </li>
            ))}
          </ul>
        </>
      )}
      <p className="text-muted-foreground text-[11px]">
        Weighted tokens: API price ratios by token type and model, an estimate
        of limit use. Per merged and per clean count all agent work, not
        people&apos;s own sessions, over the PRs merged. Totals are ratios of
        sums. ~ marks an estimated weekly figure.
      </p>
    </section>
  );
}

function BaselineCard({ data }: { data: RollupsResponse }) {
  const b = data.baseline;
  const c = data.config;
  return (
    <div className="bg-foreground/[0.03] space-y-2 rounded-xl p-3">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-medium">Baseline</h3>
        <span className="text-muted-foreground text-[11px]">
          {b
            ? `set ${new Date(b.setAt).toLocaleDateString()}`
            : `after ${c.baselineDays} days of rollups`}
        </span>
      </div>
      {b && (
        <dl className="grid grid-cols-3 gap-2 text-xs">
          <Stat label="Per merged PR" value={tok(b.values.costPerMerged)} />
          <Stat label="Per clean PR" value={tok(b.values.costPerClean)} />
          <Stat label="Clean rate" value={pct(b.values.cleanRate)} />
        </dl>
      )}
      <p className={cn("text-muted-foreground text-[11px]")}>
        Only moves to better. Alerts when the {c.avgDays}-day cost per merged PR
        is over it by {c.costPct}%, or the clean-merge rate under it by{" "}
        {c.cleanPoints} points.
      </p>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-muted-foreground text-[11px]">{label}</dt>
      <dd className="text-base font-semibold tabular-nums">{value}</dd>
    </div>
  );
}
