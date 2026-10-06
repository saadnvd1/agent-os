"use client";

import { Pause, Workflow } from "lucide-react";
import type { Session } from "@/lib/db";
import { rowMeta, sessionRowInfo, fromSqliteTime } from "@/lib/session-meta";
import type { SessionStatus } from "@/components/SessionList/SessionList.types";
import { StateDot } from "@/components/Projects/StateDot";
import { orchestratorOpenActions } from "@/stores/orchestratorOpen";
import { headerParts, type HeaderCounts } from "@/lib/orchestrator/header-line";
import { cn } from "@/lib/utils";

interface OrchestratorRowProps {
  workspaceId: string;
  session: Session | undefined;
  status: SessionStatus | undefined;
  active: boolean;
  onSelect: (sessionId: string) => void;
  // The workspace header line's live counts.
  counts: HeaderCounts;
}

// Pinned at the top of its workspace: the one agent that runs the work in
// it, titled with the workspace's header line ("Orchestrator · 3 running ·
// 1 ask"). Opening it the first time makes it.
export function OrchestratorRow({
  workspaceId,
  session,
  status,
  active,
  onSelect,
  counts,
}: OrchestratorRowProps) {
  const info = sessionRowInfo(status?.status, status?.title, status?.task);
  const working = status?.status === "running";
  // Its header line already says paused or how many asks; "Needs input"
  // would only repeat them.
  const meta =
    session &&
    !counts.paused &&
    !(status?.status === "waiting" && counts.asks > 0)
      ? rowMeta(status?.status, fromSqliteTime(session.updated_at))
      : null;
  const Icon = counts.paused ? Pause : Workflow;

  return (
    <button
      type="button"
      onClick={() =>
        session
          ? onSelect(session.id)
          : orchestratorOpenActions.request(workspaceId)
      }
      className={cn(
        "group flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2 text-left",
        "hover:bg-foreground/[0.04] min-h-11 md:min-h-9",
        active &&
          "bg-foreground/[0.06] shadow-[inset_2px_0_0_hsl(var(--primary))]"
      )}
    >
      <span className="relative shrink-0">
        <span
          aria-hidden
          className={cn(
            "flex h-5 w-5 items-center justify-center rounded-md",
            counts.paused
              ? "bg-amber-500/15 text-amber-600 dark:text-amber-400"
              : "bg-primary/12 text-primary",
            !session && "opacity-60"
          )}
        >
          <Icon className="h-3 w-3" />
        </span>
        <StateDot
          state={info.state}
          className="absolute -right-0.5 -bottom-0.5"
        />
      </span>
      <span className="flex min-w-0 flex-1 flex-col py-1 leading-tight">
        <span
          className={cn(
            "truncate text-sm",
            working || active
              ? "text-foreground font-medium"
              : "text-foreground/85"
          )}
        >
          Orchestrator
        </span>
        {session ? (
          <span className="truncate text-[11px]">
            {headerParts(counts).map((part, i) => (
              <span
                key={part}
                className={cn(
                  part === "paused" || /\basks?$/.test(part)
                    ? "text-amber-600 dark:text-amber-400"
                    : "text-muted-foreground"
                )}
              >
                {i > 0 && " · "}
                {part}
              </span>
            ))}
          </span>
        ) : (
          <span className="text-muted-foreground/70 truncate text-[11px]">
            Runs the sessions in this workspace
          </span>
        )}
        {working && info.subtitle && (
          <span className="text-muted-foreground/70 truncate text-[11px]">
            {info.subtitle}
          </span>
        )}
      </span>
      {meta && (
        <span
          className={cn(
            "shrink-0 font-mono text-[11px] tabular-nums",
            meta.tone
          )}
        >
          {meta.text}
        </span>
      )}
    </button>
  );
}
