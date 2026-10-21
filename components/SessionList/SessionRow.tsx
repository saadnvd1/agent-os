"use client";

import { AGENT_ROLE_DEFS, isAgentRole } from "@/lib/models/agent-roles";
import { isFork } from "@/lib/sessions/fork";
import { memo, useState } from "react";
import { useSnapshot } from "valtio";
import {
  AlarmClock,
  CheckSquare,
  GitFork,
  Square,
  Workflow,
} from "lucide-react";
import { compactTimeAgo } from "@/lib/session-meta";
import { wakeLabel } from "@/lib/sidebar/snooze";
import { sameRow, type SidebarRow } from "@/lib/sidebar/shelves";
import { rowStatusBadge } from "@/lib/sidebar/row-badge";
import { usePendingCardSessions } from "@/data/learning-cards";
import { useMinuteTick } from "@/hooks/useMinuteTick";
import { selectionStore, selectionActions } from "@/stores/sessionSelection";
import { cn } from "@/lib/utils";
import { QuickChangeRow } from "./QuickChangeRow";
import { useRowContext } from "./RowContext";
import { SessionRowMenu } from "./SessionRowMenu";
import { RowShell, type RowMenuKind } from "./RowShell";
import { CardBadge, NestRail, RowDot, RowRename, UnreadDot } from "./RowParts";
import { RowSubtitle } from "./RowSubtitle";
import { OrchestratorAsks } from "./OrchestratorAsks";
import { useRowDrag } from "./useGroupDrag";

// One session: status dot, title over its project, and on the right what
// needs you or when it last moved. Workers sit under their conductor. Drawn
// again only when its own row changes, not on every status push.
export const SessionRow = memo(function SessionRow({
  row,
  muted = false,
  inMachineShelf = false,
}: {
  row: SidebarRow;
  muted?: boolean;
  // Under its machine's own shelf, which already names the machine.
  inMachineShelf?: boolean;
}) {
  const ctx = useRowContext();
  const { selectedIds } = useSnapshot(selectionStore);
  const [renaming, setRenaming] = useState(false);
  const { session } = row;
  const active = session.id === ctx.activeSessionId;
  const viaName = session.started_by
    ? ctx.orchestratorNames.get(session.started_by)
    : undefined;
  const selecting = selectedIds.size > 0;
  const selected = selectedIds.has(session.id);
  const onClick = (e: React.MouseEvent) => {
    if (renaming) return;
    if (selecting || e.shiftKey) {
      e.preventDefault();
      selectionActions.toggle(
        session.id,
        selecting && e.shiftKey,
        ctx.orderedIds()
      );
      return;
    }
    ctx.onSelect(session.id);
  };

  // The server files by the project's workspace first.
  const workspaceId =
    ctx.projects.find((p) => p.id === session.project_id)?.workspace_id ??
    session.workspace_id ??
    null;
  const drag = useRowDrag(
    { id: session.id, groupId: session.session_group_id ?? null, workspaceId },
    !renaming
  );

  const badge = rowStatusBadge(row);
  const cardCount = usePendingCardSessions().get(session.id) ?? 0;

  const menu = (kind: RowMenuKind) => (
    <SessionRowMenu
      session={session}
      row={row}
      kind={kind}
      onRename={() => setRenaming(true)}
    />
  );

  return (
    <div data-session-row={session.id} {...drag}>
      <RowShell
        title={session.name}
        tipKey={`session:${session.id}`}
        highlight={selected ? "selected" : active ? "active" : null}
        onClick={onClick}
        onActivate={() => ctx.onSelect(session.id)}
        leading={
          selecting ? (
            selected ? (
              <CheckSquare className="text-primary h-4 w-4 shrink-0" />
            ) : (
              <Square className="text-muted-foreground h-4 w-4 shrink-0" />
            )
          ) : (
            <RowDot row={row} />
          )
        }
        aside={
          <>
            {viaName && (
              <span data-tip={`Started by ${viaName}`} className="shrink-0">
                <Workflow
                  aria-label={`Via orchestrator: ${viaName}`}
                  className="text-muted-foreground/60 h-3 w-3"
                />
              </span>
            )}
            {cardCount > 0 && <CardBadge count={cardCount} />}
            {row.unread && !badge && <UnreadDot />}
            {isFork(session) && (
              <GitFork className="text-muted-foreground/60 h-3 w-3 shrink-0" />
            )}
          </>
        }
        hoverHidden={!row.need && <RowTime row={row} />}
        menu={menu}
        menuLabel="Session actions"
        menuButton={!selecting}
        renaming={renaming}
      >
        {renaming ? (
          <RowRename
            initial={session.name}
            onDone={(name) => {
              setRenaming(false);
              if (name && name !== session.name) ctx.onRename(session.id, name);
            }}
          />
        ) : (
          <span className="flex min-w-0 items-center gap-1.5">
            {isAgentRole(session.agent_role) && (
              <span
                title={AGENT_ROLE_DEFS[session.agent_role].label}
                className="bg-accent text-primary grid h-4 w-4 shrink-0 place-items-center rounded text-[10px] font-semibold"
              >
                {AGENT_ROLE_DEFS[session.agent_role].label[0]}
              </span>
            )}
            <span
              className={cn(
                "truncate text-sm",
                muted && !active ? "text-muted-foreground" : "text-foreground",
                active && "font-medium"
              )}
            >
              {session.name}
            </span>
          </span>
        )}
        <RowSubtitle
          session={session}
          hideHost={inMachineShelf}
          groupName={row.groupName}
          detail={row.status?.detail}
          live={
            row.need
              ? { badge }
              : {
                  compacting: row.compacting,
                  prStage: row.status?.prStage,
                  badge,
                }
          }
        />
      </RowShell>
      {session.role === "orchestrator" && row.need && (
        <OrchestratorAsks workspaceId={session.workspace_id} />
      )}
      {(row.workers.length > 0 || !!row.quick?.length) && (
        <NestRail>
          {row.workers.map((worker) => (
            <SessionRow key={worker.session.id} row={worker} muted={muted} />
          ))}
          {row.quick?.map((q) => (
            <QuickChangeRow key={q.session.id} row={q} />
          ))}
        </NestRail>
      )}
    </div>
  );
}, sameRowProps);

type RowProps = { row: SidebarRow; muted?: boolean; inMachineShelf?: boolean };

function sameRowProps(a: RowProps, b: RowProps) {
  return (
    a.muted === b.muted &&
    a.inMachineShelf === b.inMachineShelf &&
    sameRow(a.row, b.row)
  );
}

// Snoozed: when it wakes. Otherwise when it last did something.
function RowTime({ row }: { row: SidebarRow }) {
  useMinuteTick();
  return (
    <span className="text-muted-foreground/70 flex items-center gap-1 text-xs tabular-nums">
      {row.wakesAt ? (
        <>
          <AlarmClock aria-hidden className="h-3 w-3" />
          {wakeLabel(row.wakesAt)}
        </>
      ) : (
        compactTimeAgo(new Date(row.activeAt))
      )}
    </span>
  );
}
