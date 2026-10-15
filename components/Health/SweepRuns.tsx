"use client";

import { Button } from "@/components/ui/button";
import { useRunSweep, useWorktreeSweep } from "@/data/worktree-sweep";
import { compactTimeAgo, fromSqliteTime } from "@/lib/session-meta";
import { formatBytes } from "@/lib/share/view";
import type { SweepRun } from "@/lib/worktree-sweep/types";

const KIND: Record<string, string> = {
  settled: "settled session",
  orphan: "orphan folder",
  "test-leak": "test leftover",
};

const name = (p: string) => p.split("/").pop();

function Run({ run }: { run: SweepRun }) {
  const skipped = run.details?.skipped ?? [];
  const removed = run.details?.removed ?? [];
  return (
    <li className="border-border/60 border-b px-3 py-1 last:border-b-0">
      <details>
        <summary className="flex min-h-11 cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          <span className="font-medium">
            {run.dryRun ? "Dry run, would remove" : "Removed"} {run.removed}
          </span>
          <span className="text-muted-foreground tabular-nums">
            {formatBytes(run.freedBytes)}
          </span>
          <span className="text-muted-foreground">{run.skipped} skipped</span>
          <span className="text-muted-foreground ml-auto text-xs">
            {run.finishedAt
              ? compactTimeAgo(fromSqliteTime(run.finishedAt))
              : "running"}
          </span>
        </summary>
        {run.error && (
          <p role="alert" className="text-destructive mt-2 text-sm">
            {run.error}
          </p>
        )}
        {skipped.length > 0 && (
          <div className="mt-2 space-y-1 pb-2">
            <p className="text-sm font-medium">Skipped</p>
            <ul className="text-muted-foreground space-y-1 text-xs">
              {skipped.slice(0, 200).map((s) => (
                <li key={s.path} className="break-all">
                  {name(s.path)}: {s.reason}
                </li>
              ))}
            </ul>
          </div>
        )}
        {removed.length > 0 && (
          <div className="mt-2 space-y-1 pb-2">
            <p className="text-sm font-medium">Removed</p>
            <ul className="text-muted-foreground space-y-1 text-xs">
              {removed.slice(0, 200).map((r) => (
                <li key={r.path} className="break-all">
                  {name(r.path)} ({KIND[r.kind]}, {formatBytes(r.bytes)})
                </li>
              ))}
            </ul>
          </div>
        )}
      </details>
    </li>
  );
}

// Each worktree clean-up run: what it removed, freed and skipped, and why.
export function SweepRuns() {
  const { data, isPending, error } = useWorktreeSweep();
  const run = useRunSweep();
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-muted-foreground min-w-0 flex-1 text-sm">
          Settled worktrees older than {data?.days ?? data?.defaultDays ?? 7}{" "}
          days are removed every 6 hours. Branches and conversations stay.
        </p>
        <Button
          variant="outline"
          className="min-h-11 md:min-h-8"
          disabled={run.isPending}
          onClick={() => run.mutate(true)}
        >
          Dry run
        </Button>
        <Button
          className="min-h-11 md:min-h-8"
          disabled={run.isPending}
          onClick={() => run.mutate(false)}
        >
          Run now
        </Button>
      </div>
      {run.error && (
        <p role="alert" className="text-destructive text-sm">
          {run.error.message}
        </p>
      )}
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error.message}
        </p>
      )}
      {isPending && (
        <div className="bg-muted/40 h-24 animate-pulse rounded-xl" />
      )}
      {data && data.runs.length === 0 && (
        <p className="text-muted-foreground text-sm">
          No run yet. The first one starts 10 minutes after the server does.
        </p>
      )}
      {data && data.runs.length > 0 && (
        <ul className="border-border/60 overflow-hidden rounded-xl border">
          {data.runs.map((r) => (
            <Run key={r.id} run={r} />
          ))}
        </ul>
      )}
    </div>
  );
}
