"use client";

import { ArrowUpRight } from "lucide-react";
import type { ScheduleRun, ScheduleView } from "@/lib/schedules";
import { formatRunTime } from "@/lib/schedules/cron";
import { cn } from "@/lib/utils";
import { settingsUiActions } from "@/stores/settingsUi";
import { sessionOpenActions } from "@/stores/sessionOpen";

const TONE = {
  started: "bg-primary/15 text-primary",
  claimed: "bg-primary/15 text-primary",
  skipped: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  failed: "bg-destructive/15 text-destructive",
} as const;

const LABEL = {
  started: "Started",
  claimed: "Starting",
  skipped: "Skipped",
  failed: "Failed",
} as const;

const TRIGGER = {
  schedule: null,
  "catch-up": "Caught up",
  manual: "Run now",
} as const;

export function OutcomeChip({ run }: { run: ScheduleRun }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-medium",
        TONE[run.outcome]
      )}
    >
      {LABEL[run.outcome]}
    </span>
  );
}

// SQLite's datetime('now') is UTC without a zone marker.
const createdMs = (t: string) => Date.parse(`${t.replace(" ", "T")}Z`);

export function RunHistory({
  runs,
  schedule,
}: {
  runs: ScheduleRun[];
  schedule: ScheduleView;
}) {
  return (
    <div className="space-y-2">
      <p className="label-mono text-muted-foreground">History</p>
      {runs.length === 0 && (
        <p className="text-muted-foreground text-sm">No runs yet.</p>
      )}
      <ul className="divide-border/60 divide-y">
        {runs.map((r) => {
          const when =
            r.trigger === "manual" ? createdMs(r.created_at) : r.slot_at;
          const extra = [
            TRIGGER[r.trigger],
            r.detail && r.detail !== "caught up" ? r.detail : null,
          ].filter(Boolean);
          return (
            <li key={r.id} className="flex min-h-11 items-center gap-3 py-2">
              <OutcomeChip run={r} />
              <div className="min-w-0 flex-1">
                <p className="text-sm tabular-nums">
                  {formatRunTime(when, schedule.timezone)}
                </p>
                {extra.length > 0 && (
                  <p className="text-muted-foreground truncate text-xs">
                    {extra.join(" · ")}
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
