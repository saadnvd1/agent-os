"use client";

import { useState } from "react";
import { useSnapshot } from "valtio";
import { CheckSquare, GitFork, MoreHorizontal, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import * as DM from "@/components/ui/dropdown-menu";
import * as CM from "@/components/ui/context-menu";
import { compactTimeAgo, fromSqliteTime } from "@/lib/session-meta";
import type { SidebarRow } from "@/lib/sidebar/shelves";
import { selectionStore, selectionActions } from "@/stores/sessionSelection";
import { cn } from "@/lib/utils";
import { useRowContext } from "./RowContext";
import { SessionRowMenu } from "./SessionRowMenu";
import { RowBadge, RowDot, RowRename } from "./RowParts";
import { RowSubtitle } from "./RowSubtitle";
import { OrchestratorAsks } from "./OrchestratorAsks";

// One session: status dot, title over its project, and on the right what
// needs you or when it last moved. Workers sit under their conductor.
export function SessionRow({
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
        ctx.orderedIds
      );
      return;
    }
    ctx.onSelect(session.id);
  };

  const content = (
    <div
      role="button"
      tabIndex={0}
      title={session.name}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          ctx.onSelect(session.id);
        }
      }}
      className={cn(
        "group relative flex min-h-11 cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-1.5 transition-colors",
        selected
          ? "bg-primary/15"
          : active
            ? "bg-primary/10"
            : "hover:bg-foreground/[0.04]"
      )}
    >
      {selecting ? (
        selected ? (
          <CheckSquare className="text-primary h-4 w-4 shrink-0" />
        ) : (
          <Square className="text-muted-foreground h-4 w-4 shrink-0" />
        )
      ) : (
        <RowDot row={row} />
      )}
      <span className="flex min-w-0 flex-1 flex-col leading-tight">
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
      </span>
      {session.parent_session_id && (
        <GitFork className="text-muted-foreground/60 h-3 w-3 shrink-0" />
      )}
      <span className="flex shrink-0 items-center gap-2 md:group-hover:invisible md:group-has-[:focus-visible]:invisible md:group-has-[[data-state=open]]:invisible">
        <RowBadge row={row} />
        {!row.need && (
          <span className="text-muted-foreground/70 text-xs tabular-nums">
            {compactTimeAgo(fromSqliteTime(session.updated_at))}
          </span>
        )}
      </span>
      {!selecting && (
        <DM.DropdownMenu>
          <DM.DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Session actions"
              className="-mr-2.5 h-11 w-11 shrink-0 md:absolute md:top-1/2 md:right-1.5 md:mr-0 md:h-7 md:w-7 md:-translate-y-1/2 md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100 md:data-[state=open]:opacity-100 [@media(hover:none)]:md:static [@media(hover:none)]:md:-mr-2.5 [@media(hover:none)]:md:h-11 [@media(hover:none)]:md:w-11 [@media(hover:none)]:md:translate-y-0 [@media(hover:none)]:md:opacity-100"
            >
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DM.DropdownMenuTrigger>
          <DM.DropdownMenuContent
            align="end"
            className="w-56"
            onClick={(e) => e.stopPropagation()}
          >
            <SessionRowMenu
              session={session}
              kind="dropdown"
              onRename={() => setRenaming(true)}
            />
          </DM.DropdownMenuContent>
        </DM.DropdownMenu>
      )}
    </div>
  );

  return (
    <div className={cn(nested && "pl-5")}>
      <CM.ContextMenu>
        <CM.ContextMenuTrigger asChild>{content}</CM.ContextMenuTrigger>
        <CM.ContextMenuContent className="w-56">
          <SessionRowMenu
            session={session}
            kind="context"
            onRename={() => setRenaming(true)}
          />
        </CM.ContextMenuContent>
      </CM.ContextMenu>
      {session.role === "orchestrator" && row.need && (
        <OrchestratorAsks workspaceId={session.workspace_id} />
      )}
      {row.workers.map((worker) => (
        <SessionRow key={worker.session.id} row={worker} muted={muted} nested />
      ))}
    </div>
  );
}
