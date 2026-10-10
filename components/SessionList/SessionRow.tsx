"use client";

import { memo, useState } from "react";
import { useSnapshot } from "valtio";
import { CheckSquare, GitFork, Square } from "lucide-react";
import { compactTimeAgo, fromSqliteTime } from "@/lib/session-meta";
import { sameRow, type SidebarRow } from "@/lib/sidebar/shelves";
import { useMinuteTick } from "@/hooks/useMinuteTick";
import { selectionStore, selectionActions } from "@/stores/sessionSelection";
import { cn } from "@/lib/utils";
import { useRowContext } from "./RowContext";
import { SessionRowMenu } from "./SessionRowMenu";
import { RowShell, type RowMenuKind } from "./RowShell";
import { RowBadge, RowDot, RowRename } from "./RowParts";
import { RowSubtitle } from "./RowSubtitle";
import { OrchestratorAsks } from "./OrchestratorAsks";

// One session: status dot, title over its project, and on the right what
// needs you or when it last moved. Workers sit under their conductor. Drawn
// again only when its own row changes, not on every status push.
export const SessionRow = memo(function SessionRow({
  row,
  muted = false,
  nested = false,
}: {
  row: SidebarRow;
  muted?: boolean;
  nested?: boolean;
}) {
  const ctx = useRowContext();
  const { selectedIds } = useSnapshot(selectionStore);
  const [renaming, setRenaming] = useState(false);
  const { session } = row;
  const active = session.id === ctx.activeSessionId;
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

  const menu = (kind: RowMenuKind) => (
    <SessionRowMenu
      session={session}
      kind={kind}
      onRename={() => setRenaming(true)}
    />
  );

  return (
    <div className={cn(nested && "pl-5")}>
      <RowShell
        title={session.name}
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
          session.parent_session_id && (
            <GitFork className="text-muted-foreground/60 h-3 w-3 shrink-0" />
          )
        }
        trailing={
          <>
            <RowBadge row={row} />
            {!row.need && <TimeAgo at={session.updated_at} />}
          </>
        }
        menu={menu}
        menuLabel="Session actions"
        menuButton={!selecting}
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
          <span
            className={cn(
              "truncate text-sm",
              muted && !active ? "text-muted-foreground" : "text-foreground",
              active && "font-medium"
            )}
          >
            {session.name}
          </span>
        )}
        <RowSubtitle session={session} detail={row.status?.detail} />
      </RowShell>
      {session.role === "orchestrator" && row.need && (
        <OrchestratorAsks workspaceId={session.workspace_id} />
      )}
      {row.workers.map((worker) => (
        <SessionRow key={worker.session.id} row={worker} muted={muted} nested />
      ))}
    </div>
  );
}, sameRowProps);

function sameRowProps(
  a: { row: SidebarRow; muted?: boolean; nested?: boolean },
  b: { row: SidebarRow; muted?: boolean; nested?: boolean }
) {
  return a.muted === b.muted && a.nested === b.nested && sameRow(a.row, b.row);
}

function TimeAgo({ at }: { at: string }) {
  useMinuteTick();
  return (
    <span className="text-muted-foreground/70 text-xs tabular-nums">
      {compactTimeAgo(fromSqliteTime(at))}
    </span>
  );
}
