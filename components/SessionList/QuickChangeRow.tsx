"use client";

import { GitPullRequest } from "lucide-react";
import type { SidebarRow } from "@/lib/sidebar/shelves";
import { TASK_STATE } from "@/components/Tasks/task-state-labels";
import { cn } from "@/lib/utils";

// One of an orchestrator's quick changes, under it: its name, its PR and
// where CI stands. It has no agent to open, so the row opens its PR.
export function QuickChangeRow({ row }: { row: SidebarRow }) {
  const { session } = row;
  const pr = session.pr_number && session.pr_url ? session.pr_url : null;
  const state = row.task ? TASK_STATE[row.task] : null;
  const label = !session.pr_number
    ? "Editing, no PR yet"
    : `PR #${session.pr_number}${state ? ` · ${state.label}` : ""}`;
  const body = (
    <>
      <GitPullRequest
        aria-hidden
        className={cn(
          "h-3.5 w-3.5 shrink-0",
          state?.tone ?? "text-muted-foreground"
        )}
      />
      <span className="flex min-w-0 flex-1 flex-col leading-tight">
        <span className="text-foreground truncate text-[13px]">
          {session.name}
        </span>
        <span
          className={cn(
            "mt-0.5 truncate text-xs",
            session.pr_number && state ? state.tone : "text-muted-foreground"
          )}
        >
          {label}
        </span>
      </span>
    </>
  );
  const frame =
    "ml-5 flex min-h-11 items-center gap-2 rounded-md px-2.5 py-1 md:min-h-9";
  return pr ? (
    <a
      href={pr}
      target="_blank"
      rel="noreferrer"
      title={`Quick change: ${session.name}\n${label}`}
      className={cn(frame, "hover:bg-muted/60 transition-colors")}
    >
      {body}
    </a>
  ) : (
    <div title={`Quick change: ${session.name}\n${label}`} className={frame}>
      {body}
    </div>
  );
}
