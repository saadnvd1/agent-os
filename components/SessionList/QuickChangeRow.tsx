"use client";

import { GitPullRequest } from "lucide-react";
import type { SidebarRow } from "@/lib/sidebar/shelves";
import { TASK_STATE } from "@/components/Tasks/task-state-labels";
import { cn } from "@/lib/utils";
import { RowShell } from "./RowShell";
import { SessionRowMenu } from "./SessionRowMenu";

// One of an orchestrator's quick changes, under it: its name, its PR and
// where CI stands. It has no agent to open, so the row opens its PR.
export function QuickChangeRow({ row }: { row: SidebarRow }) {
  const { session } = row;
  const pr = session.pr_number && session.pr_url ? session.pr_url : null;
  const state = row.task ? TASK_STATE[row.task] : null;
  const label = !session.pr_number
    ? "Editing, no PR yet"
    : `PR #${session.pr_number}${state ? ` · ${state.label}` : ""}`;
  const leading = (
    <GitPullRequest
      aria-hidden
      className={cn(
        "h-3.5 w-3.5 shrink-0",
        state?.tone ?? "text-muted-foreground"
      )}
    />
  );
  const body = (
    <>
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
    </>
  );
  const openPr = pr ? () => window.open(pr, "_blank") : undefined;
  return (
    <div className="ml-5">
      <RowShell
        title={`Quick change: ${session.name}\n${label}`}
        onActivate={openPr}
        onClick={openPr}
        leading={leading}
        menu={(kind) => (
          <SessionRowMenu
            session={session}
            row={row}
            kind={kind}
            onRename={() => {}}
          />
        )}
        menuLabel="Quick change actions"
      >
        {body}
      </RowShell>
    </div>
  );
}
