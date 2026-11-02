"use client";

import { memo } from "react";
import { sameRow, type SidebarRow } from "@/lib/sidebar/shelves";
import {
  memberCounts,
  memberDot,
  teamRowText,
} from "@/lib/sidebar/orchestrator-row";
import { cn } from "@/lib/utils";
import { CHIEF } from "@/lib/leads/order";
import { useRowContext } from "./RowContext";
import { RowFrame } from "./OrchestratorPinRow";
import { ActiveTick } from "./RowShell";
import { LeadAvatar } from "./RowParts";

// A workspace's team under All workspaces, folded into one row: its name, an
// avatar per member (the chief's C first) and what needs you. Tapping it opens
// the chief's chat (the orchestrator's when there is no chief), a member's
// avatar opens that member's, and the view stays on All workspaces.
export const TeamRow = memo(function TeamRow({
  workspaceId,
  rows,
}: {
  workspaceId: string;
  rows: SidebarRow[];
}) {
  const ctx = useRowContext();
  const name = ctx.workspaceNames.get(workspaceId) ?? "Workspace";
  const overview = ctx.orchestrators.find((o) => o.workspaceId === workspaceId);
  const workspace = {
    running: ctx.runningByWorkspace.get(workspaceId) ?? 0,
    queued: ctx.queuedByWorkspace.get(workspaceId) ?? 0,
  };
  const { needs, status } = teamRowText(rows, {
    asks: overview?.asks.length ?? 0,
    paused: !!overview?.paused,
    running: workspace.running,
    inReview: overview?.inReview ?? 0,
    queued: workspace.queued,
  });
  const members = rows.flatMap((row) => {
    const member = ctx.team.get(row.session.id);
    if (!member) return [];
    const { asks } = memberCounts(member, overview, workspace);
    return [{ row, member, dot: memberDot(row, asks) }];
  });
  const chief = members.find((m) => m.member.kind === CHIEF)?.row.session.id;
  const target = chief ?? overview?.sessionId ?? rows[0]?.session.id;
  const active =
    !!ctx.activeSessionId &&
    (rows.some((r) => r.session.id === ctx.activeSessionId) ||
      overview?.sessionId === ctx.activeSessionId);
  const summary = needs ? `${needs} · ${status}` : status;
  return (
    <RowFrame
      data-team-row={workspaceId}
      data-tip={`${name} team\n${summary}`}
      aria-label={`${name} team: ${summary}`}
      aria-current={active ? "true" : undefined}
      onActivate={() => target && ctx.onSelect(target)}
      className={
        active
          ? "bg-foreground/[0.07]"
          : "bg-muted/50 hover:bg-muted has-[[data-member]:hover]:bg-muted/50"
      }
    >
      {active && <ActiveTick />}
      <span className="flex min-w-0 flex-1 flex-col leading-tight">
        <span className="flex min-w-0 items-center gap-2">
          <span className="text-foreground min-w-0 flex-1 truncate text-[13px] font-medium">
            {name}
          </span>
          <span className="flex shrink-0 items-center gap-[5px]">
            {members.map(({ row, member, dot }) => (
              <button
                key={row.session.id}
                type="button"
                data-member={row.session.id}
                aria-label={`Open ${member.title}`}
                aria-current={
                  row.session.id === ctx.activeSessionId ? "true" : undefined
                }
                onClick={(e) => {
                  e.stopPropagation();
                  ctx.onSelect(row.session.id);
                }}
                className={cn(
                  "relative cursor-pointer rounded-[7px] before:absolute before:-inset-1.5 before:content-['']",
                  row.session.id === ctx.activeSessionId &&
                    "ring-foreground/60 ring-2 ring-offset-1"
                )}
              >
                <LeadAvatar
                  member={member}
                  dot={dot === "idle" ? undefined : dot}
                />
              </button>
            ))}
          </span>
        </span>
        <span className="text-muted-foreground/80 mt-0.5 truncate text-xs">
          {needs && (
            <>
              <span className="font-semibold text-amber-700 tabular-nums dark:text-amber-400">
                {needs}
              </span>
              {" · "}
            </>
          )}
          {status}
        </span>
      </span>
    </RowFrame>
  );
}, sameProps);

type Props = { workspaceId: string; rows: SidebarRow[] };

function sameProps(a: Props, b: Props) {
  return (
    a.workspaceId === b.workspaceId &&
    a.rows.length === b.rows.length &&
    a.rows.every((r, i) => sameRow(r, b.rows[i]))
  );
}
