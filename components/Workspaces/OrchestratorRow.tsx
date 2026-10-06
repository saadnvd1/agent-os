"use client";

import { Workflow } from "lucide-react";
import type { Session } from "@/lib/db";
import { rowMeta, sessionRowInfo, fromSqliteTime } from "@/lib/session-meta";
import type { SessionStatus } from "@/components/SessionList/SessionList.types";
import { StateDot } from "@/components/Projects/StateDot";
import { orchestratorOpenActions } from "@/stores/orchestratorOpen";
import { cn } from "@/lib/utils";

interface OrchestratorRowProps {
  workspaceId: string;
  session: Session | undefined;
  status: SessionStatus | undefined;
  active: boolean;
  onSelect: (sessionId: string) => void;
}

// Pinned at the top of its workspace: the one agent that runs the work in
// it. Opening it the first time makes it.
export function OrchestratorRow({
  workspaceId,
  session,
  status,
  active,
  onSelect,
}: OrchestratorRowProps) {
  const info = sessionRowInfo(status?.status, status?.title, status?.task);
  const working = status?.status === "running";
  const meta = session
    ? rowMeta(status?.status, fromSqliteTime(session.updated_at))
    : null;
  const subtitle = session
    ? info.subtitle
    : "Runs the sessions in this workspace";

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
            "bg-primary/12 text-primary flex h-5 w-5 items-center justify-center rounded-md",
            !session && "opacity-60"
          )}
        >
          <Workflow className="h-3 w-3" />
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
        {subtitle && (
          <span className="text-muted-foreground/70 truncate text-[11px]">
            {subtitle}
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
