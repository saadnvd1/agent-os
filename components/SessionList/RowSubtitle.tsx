"use client";

import { Repeat, Layers } from "lucide-react";
import { HostBadge } from "@/components/Hosts";
import { rowGroup } from "@/lib/recipes/chip";
import type { Session } from "@/lib/db";
import { LiveLine, type LiveInput } from "./LiveLine";
import { headerParts } from "@/lib/orchestrator/header-line";
import { cn } from "@/lib/utils";
import { usageLabel, useSessionUsage } from "@/data/load";
import { useRowContext } from "./RowContext";

const ATTENTION = (part: string) => part === "paused" || /\basks?$/.test(part);

// Under the title: the project (and its machine when it isn't this one),
// or for an orchestrator its workspace's live line: "AgentOS · paused ·
// 3 running · 1 ask". A program that reports its own status adds what it
// said first: "Apply 3 changes? · agent-os" (its text, as plain text).
export function RowSubtitle({
  session,
  detail,
  live,
}: {
  session: Session;
  detail?: string | null;
  live?: LiveInput;
}) {
  const ctx = useRowContext();
  // What its processes use, on a busy session: "3.1 cores · 4.2 GB".
  const usage = useSessionUsage(session.id);
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
  const group = rowGroup(session);
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <LiveLine {...live} />
      {group && (
        <span
          className="text-muted-foreground/70 hidden min-w-0 shrink items-center gap-1 truncate text-xs @[14rem]:flex"
          title={group.kind === "recipe" ? "A recipe run" : "A piece of a plan"}
        >
          {group.kind === "recipe" ? (
            <Repeat aria-hidden className="h-3 w-3 shrink-0" />
          ) : (
            <Layers aria-hidden className="h-3 w-3 shrink-0" />
          )}
          <span className="truncate">{group.text}</span>
        </span>
      )}
      {(project || detail || usage) && (
        <span className="text-muted-foreground/70 min-w-0 truncate text-xs">
          {[usage && usageLabel(usage), detail?.slice(0, 200), project]
            .filter(Boolean)
            .join(" · ")}
        </span>
      )}
      <HostBadge hostId={session.host_id} />
    </span>
  );
}
