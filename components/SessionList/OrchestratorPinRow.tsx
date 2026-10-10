"use client";

import { memo, useState } from "react";
import { MoreHorizontal, Workflow } from "lucide-react";
import { Button } from "@/components/ui/button";
import * as DM from "@/components/ui/dropdown-menu";
import * as CM from "@/components/ui/context-menu";
import { sameRow, type SidebarRow } from "@/lib/sidebar/shelves";
import { orchestratorRowText } from "@/lib/sidebar/orchestrator-row";
import { cn } from "@/lib/utils";
import { useRowContext } from "./RowContext";
import { SessionRowMenu } from "./SessionRowMenu";
import { RowRename } from "./RowParts";

// A workspace's orchestrator, pinned above its sessions and titled with the
// workspace's name: what it's doing and how many asks wait on you, on a line
// of their own. Unpinning drops it back among the others.
export const OrchestratorPinRow = memo(function OrchestratorPinRow({
  row,
}: {
  row: SidebarRow;
}) {
  const ctx = useRowContext();
  const [renaming, setRenaming] = useState(false);
  const { session } = row;
  const ws = session.workspace_id ?? "";
  const overview = ctx.orchestrators.find((o) => o.workspaceId === ws);
  const paused = !!overview?.paused;
  const active = session.id === ctx.activeSessionId;
  const { status, asks } = orchestratorRowText(row, {
    asks: overview?.asks.length ?? 0,
    paused,
    running: ctx.runningByWorkspace.get(ws) ?? 0,
    inReview: overview?.inReview ?? 0,
  });
  const label = ctx.workspaceNames.get(ws) ?? "Orchestrator";
  const summary = asks ? `${status} · ${asks}` : status;
  const menu = (kind: "dropdown" | "context") => (
    <SessionRowMenu
      session={session}
      kind={kind}
      onRename={() => setRenaming(true)}
    />
  );

  const content = (
    <div
      role="button"
      tabIndex={0}
      title={`${label}\n${summary}`}
      onClick={() => !renaming && ctx.onSelect(session.id)}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          ctx.onSelect(session.id);
        }
      }}
      className={cn(
        "group border-border/70 relative flex min-h-11 cursor-pointer items-center gap-2.5 rounded-lg border px-2.5 py-1.5 transition-colors",
        active
          ? "bg-primary/10 border-primary/30"
          : "bg-muted/50 hover:bg-muted"
      )}
    >
      <Workflow
        aria-hidden
        className={cn(
          "h-4 w-4 shrink-0",
          row.need === "failed"
            ? "text-red-500"
            : paused
              ? "text-amber-500"
              : row.working
                ? "text-green-600 dark:text-green-500"
                : "text-muted-foreground"
        )}
      />
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
          <>
            <span
              className={cn(
                "text-foreground min-w-0 truncate text-[13px]",
                active ? "font-semibold" : "font-medium"
              )}
            >
              {label}
            </span>
            <span className="text-muted-foreground/80 mt-0.5 truncate text-xs">
              {status}
              {asks && (
                <>
                  {" · "}
                  <span className="font-semibold text-amber-700 tabular-nums dark:text-amber-400">
                    {asks}
                  </span>
                </>
              )}
            </span>
          </>
        )}
      </span>
      <DM.DropdownMenu>
        <DM.DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Orchestrator actions"
            className="-mr-2.5 h-11 w-11 shrink-0 md:-mr-1.5 md:h-7 md:w-7 [@media(hover:none)]:md:-mr-2.5 [@media(hover:none)]:md:h-11 [@media(hover:none)]:md:w-11"
          >
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DM.DropdownMenuTrigger>
        <DM.DropdownMenuContent
          align="end"
          className="w-56"
          onClick={(e) => e.stopPropagation()}
        >
          {menu("dropdown")}
        </DM.DropdownMenuContent>
      </DM.DropdownMenu>
    </div>
  );

  return (
    <CM.ContextMenu>
      <CM.ContextMenuTrigger asChild>{content}</CM.ContextMenuTrigger>
      <CM.ContextMenuContent className="w-56">
        {menu("context")}
      </CM.ContextMenuContent>
    </CM.ContextMenu>
  );
}, sameProps);

// Its counts come from the row context, which changes when they do.
function sameProps(a: { row: SidebarRow }, b: { row: SidebarRow }) {
  return sameRow(a.row, b.row);
}
