"use client";

import { HostBadge } from "@/components/Hosts";
import type { Session } from "@/lib/db";
import { headerParts } from "@/lib/orchestrator/header-line";
import { cn } from "@/lib/utils";
import { useRowContext } from "./RowContext";

const ATTENTION = (part: string) => part === "paused" || /\basks?$/.test(part);

// Under the title: the project (and its machine when it isn't this one),
// or for an orchestrator its workspace's live line: "AgentOS · paused ·
// 3 running · 1 ask". A program that reports its own status adds what it
// said first: "Apply 3 changes? · agent-os" (its text, as plain text).
export function RowSubtitle({
  session,
  detail,
}: {
  session: Session;
  detail?: string | null;
}) {
  const ctx = useRowContext();
  if (session.role === "orchestrator") {
    const ws = session.workspace_id ?? "";
    const overview = ctx.orchestrators.find((o) => o.workspaceId === ws);
    const parts = headerParts({
      running: ctx.runningByWorkspace.get(ws) ?? 0,
      inReview: overview?.inReview ?? 0,
      asks: overview?.asks.length ?? 0,
      paused: !!overview?.paused,
    });
    return (
      <span className="text-muted-foreground/70 truncate text-xs">
        {ctx.workspaceNames.get(ws) ?? "Orchestrator"}
        {parts.map((part) => (
          <span
            key={part}
            className={cn(
              ATTENTION(part) && "text-amber-600 dark:text-amber-400"
            )}
          >
            {" · "}
            {part}
          </span>
        ))}
      </span>
    );
  }
  const project = ctx.projectNames.get(session.project_id ?? "");
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      {(project || detail) && (
        <span className="text-muted-foreground/70 truncate text-xs">
          {[detail?.slice(0, 200), project].filter(Boolean).join(" · ")}
        </span>
      )}
      <HostBadge hostId={session.host_id} />
    </span>
  );
}
