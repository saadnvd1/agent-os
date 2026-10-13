"use client";

import { ArrowUpRight } from "lucide-react";
import type { RecipeRun, RecipeTotals } from "@/lib/recipes/types";
import { formatRunTime } from "@/lib/schedules/cron";
import { settingsUiActions } from "@/stores/settingsUi";
import { sessionOpenActions } from "@/stores/sessionOpen";
import { RunChip } from "./RunChip";
import { duration, money, sqlMs, triggerLabel } from "./format";

export function Totals({ totals }: { totals: RecipeTotals }) {
  if (!totals.runs) return null;
  const bits = [
    `${totals.runs} ${totals.runs === 1 ? "run" : "runs"}`,
    totals.failed ? `${totals.failed} failed` : null,
    totals.costUsd ? money(totals.costUsd) : null,
    totals.avgMs ? `avg ${duration(totals.avgMs)}` : null,
  ].filter(Boolean);
  return <p className="text-muted-foreground text-xs">{bits.join(" · ")}</p>;
}

function Facts({ run }: { run: RecipeRun }) {
  const outputs = run.outputs
    ? Object.entries(run.outputs)
        .map(([k, v]) => `${k} ${v}`)
        .join(" · ")
    : "";
  const text = [outputs, run.summary ?? run.error].filter(Boolean).join(". ");
  return text ? (
    <p className="text-muted-foreground line-clamp-2 text-xs">{text}</p>
  ) : null;
}

export function RunHistory({ runs }: { runs: RecipeRun[] }) {
  return (
    <div className="space-y-2">
      <p className="label-mono text-muted-foreground">History</p>
      {runs.length === 0 && (
        <p className="text-muted-foreground text-sm">No runs yet.</p>
      )}
      <ul className="divide-border/60 divide-y">
        {runs.map((r) => {
          const stats = [duration(r.duration_ms), money(r.cost_usd)]
            .filter(Boolean)
            .join(" · ");
          return (
            <li key={r.id} className="flex items-start gap-3 py-2.5">
              <RunChip status={r.status} />
              <div className="min-w-0 flex-1 space-y-0.5">
                <p className="text-sm tabular-nums">
                  #{r.seq} · {formatRunTime(sqlMs(r.created_at))}
                </p>
                <p className="text-muted-foreground truncate text-xs">
                  {[
                    triggerLabel(r),
                    r.pr_number ? `PR #${r.pr_number}` : null,
                    stats,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
                <Facts run={r} />
                {r.note && (
                  <p className="text-muted-foreground truncate text-xs italic">
                    Note: {r.note}
                  </p>
                )}
              </div>
              {r.session_id && (
                <button
                  type="button"
                  onClick={() => {
                    sessionOpenActions.request(r.session_id!);
                    settingsUiActions.close();
                  }}
                  className="text-primary -mr-2 flex min-h-11 shrink-0 items-center gap-1 px-2 text-xs font-medium"
                >
                  Open
                  <ArrowUpRight className="h-3.5 w-3.5" />
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
