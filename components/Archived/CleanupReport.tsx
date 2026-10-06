"use client";

import type { BulkResult } from "@/lib/done/bulk";

// What a clean-up just did: done, kept a worktree, refused and why.
export function CleanupReport({ report }: { report: BulkResult }) {
  const kept = report.done.filter((d) => d.worktree.action === "kept");
  if (!report.done.length && !report.refused.length)
    return (
      <p className="text-muted-foreground text-sm">
        No idle sessions to clean up.
      </p>
    );
  return (
    <div className="bg-foreground/[0.03] space-y-2 rounded-xl px-3 py-3 text-sm">
      <p className="font-medium">
        {report.done.length} done · {kept.length} kept a worktree ·{" "}
        {report.refused.length} refused
      </p>
      {kept.map((d) => (
        <p key={d.id} className="text-muted-foreground text-xs break-words">
          <span className="text-foreground">{d.name}</span>: worktree kept,{" "}
          {d.worktree.action === "kept" && d.worktree.why}
        </p>
      ))}
      {report.refused.map((r) => (
        <p
          key={r.id}
          className="text-xs break-words whitespace-pre-wrap text-amber-600 dark:text-amber-400"
        >
          <span className="font-medium">{r.name}</span>: {r.reason}
        </p>
      ))}
    </div>
  );
}
