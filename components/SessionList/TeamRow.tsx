"use client";

import { memo } from "react";
import { sameRow, type SidebarRow } from "@/lib/sidebar/shelves";
import {
  memberCounts,
  memberDot,
  teamRowText,
} from "@/lib/sidebar/orchestrator-row";
import { sidebarUiActions } from "@/stores/sidebarUi";
import { useRowContext } from "./RowContext";
import { RowFrame } from "./OrchestratorPinRow";
import { LeadAvatar } from "./RowParts";

// A workspace's team under All workspaces, folded into one row: its name, an
// avatar per member (the chief's C first) and what needs you. Tapping it
// opens that workspace, where each member has its own card.
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
  const summary = needs ? `${needs} · ${status}` : status;
  return (
    <RowFrame
      data-team-row={workspaceId}
      data-tip={`${name} team\n${summary}`}
      aria-label={`${name} team: ${summary}`}
      onActivate={() => sidebarUiActions.setWorkspace(workspaceId)}
      className="bg-muted/50 hover:bg-muted"
    >
      <span className="flex min-w-0 flex-1 flex-col leading-tight">
        <span className="flex min-w-0 items-center gap-2">
          <span className="text-foreground min-w-0 flex-1 truncate text-[13px] font-medium">
            {name}
          </span>
          <span className="flex shrink-0 items-center gap-[5px]">
            {members.map(({ row, member, dot }) => (
              <LeadAvatar
                key={row.session.id}
                member={member}
                dot={dot === "idle" ? undefined : dot}
              />
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
