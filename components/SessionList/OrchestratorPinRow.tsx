"use client";

import { memo, useState } from "react";
import { MoreHorizontal, Workflow } from "lucide-react";
import { Button } from "@/components/ui/button";
import * as DM from "@/components/ui/dropdown-menu";
import * as CM from "@/components/ui/context-menu";
import { sameRow, type SidebarRow } from "@/lib/sidebar/shelves";
import { visibleChips } from "@/lib/sidebar/rollup";
import { sidebarUi, sidebarUiActions } from "@/stores/sidebarUi";
import { useSnapshot } from "valtio";
import { orchestratorRowText } from "@/lib/sidebar/orchestrator-row";
import { cn } from "@/lib/utils";
import { orchestratorOpenActions } from "@/stores/orchestratorOpen";
import { useRowContext } from "./RowContext";
import { SessionRowMenu } from "./SessionRowMenu";
import { ActiveTick, ROW_MENU_CONTENT } from "./RowShell";
import { keepRenameFocus, RowRename, UnreadDot } from "./RowParts";
import { QuickChangeRow } from "./QuickChangeRow";
import { NestRail } from "./RowParts";

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
  const { state, status, asks } = orchestratorRowText(row, {
    asks: overview?.asks.length ?? 0,
    paused,
    running: ctx.runningByWorkspace.get(ws) ?? 0,
    inReview: overview?.inReview ?? 0,
    queued: ctx.queuedByWorkspace.get(ws) ?? 0,
  });
  const chips = visibleChips(ctx.rollups.get(session.id));
  const { orchestratorId } = useSnapshot(sidebarUi);
  const filtering = orchestratorId === session.id;
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
    <RowFrame
      data-tip={`${label}\n${summary}`}
      onActivate={() => !renaming && ctx.onSelect(session.id)}
      className={
        active
          ? "bg-foreground/[0.07]"
          : "bg-muted/50 hover:bg-muted has-[[data-chip]:hover]:bg-muted/50"
      }
    >
      {active && <ActiveTick />}
      <Workflow
        aria-hidden
        className={cn(
          "h-4 w-4 shrink-0",
          {
            Paused: "text-amber-500",
            Failed: "text-red-500",
            Working: "text-green-600 dark:text-green-500",
            Replied: "text-primary",
            Waiting: "text-muted-foreground",
            Idle: "text-muted-foreground",
          }[state]
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
            {chips.length > 0 && (
              <button
                type="button"
                aria-pressed={filtering}
                data-chip
                aria-label={`Show only ${label}'s work`}
                onClick={(e) => {
                  e.stopPropagation();
                  sidebarUiActions.setOrchestrator(
                    filtering ? null : session.id
                  );
                }}
                className={cn(
                  "text-muted-foreground -mx-1.5 mt-0.5 flex min-h-6 cursor-pointer flex-wrap items-center gap-x-2.5 self-start rounded-md px-1.5 text-xs transition-colors md:min-h-5",
                  "hover:bg-foreground/10 hover:text-foreground",
                  "focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none",
                  filtering && "bg-foreground/10 text-foreground"
                )}
              >
                {chips.map((c) => (
                  <span key={c.key} className="flex items-center gap-1">
                    <span
                      aria-hidden
                      className={cn("h-1.5 w-1.5 rounded-full", c.dot)}
                    />
                    <span className="tabular-nums">
                      {ctx.rollups.get(session.id)![c.key]} {c.label}
                    </span>
                  </span>
                ))}
              </button>
            )}
          </>
        )}
      </span>
      {row.unread && <UnreadDot />}
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
          className={ROW_MENU_CONTENT}
          onCloseAutoFocus={keepRenameFocus(renaming)}
          onClick={(e) => e.stopPropagation()}
        >
          {menu("dropdown")}
        </DM.DropdownMenuContent>
      </DM.DropdownMenu>
    </RowFrame>
  );

  return (
    <>
      <CM.ContextMenu>
        <CM.ContextMenuTrigger asChild>{content}</CM.ContextMenuTrigger>
        <CM.ContextMenuContent
          className={ROW_MENU_CONTENT}
          onCloseAutoFocus={keepRenameFocus(renaming)}
        >
          {menu("context")}
        </CM.ContextMenuContent>
      </CM.ContextMenu>
      {!!row.quick?.length && (
        <NestRail>
          {row.quick.map((q) => (
            <QuickChangeRow key={q.session.id} row={q} />
          ))}
        </NestRail>
      )}
    </>
  );
}, sameProps);

// A workspace with no orchestrator yet: the same row, muted, that makes,
// pins and opens one.
export function OrchestratorStartRow({
  workspaceId,
  name,
}: {
  workspaceId: string;
  name: string;
}) {
  return (
    <RowFrame
      data-tip={`${name}\nStart orchestrator`}
      onActivate={() => orchestratorOpenActions.request(workspaceId)}
      className="hover:bg-muted/50 border-dashed"
    >
      <Workflow
        aria-hidden
        className="text-muted-foreground/50 h-4 w-4 shrink-0"
      />
      <span className="flex min-w-0 flex-1 flex-col leading-tight">
        <span className="text-muted-foreground min-w-0 truncate text-[13px] font-medium">
          {name}
        </span>
        <span className="text-muted-foreground/70 mt-0.5 truncate text-xs">
          Start orchestrator
        </span>
      </span>
    </RowFrame>
  );
}

// The orchestrator rows' shared shape: a bordered card a tap or Enter opens.
// The rest goes on the div, for the context menu trigger's props and ref.
function RowFrame({
  onActivate,
  className,
  ...rest
}: Omit<React.ComponentProps<"div">, "onClick" | "onKeyDown"> & {
  onActivate: () => void;
}) {
  return (
    <div
      {...rest}
      role="button"
      tabIndex={0}
      onClick={onActivate}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onActivate();
        }
      }}
      className={cn(
        "group border-border/70 relative flex min-h-11 cursor-pointer items-center gap-2.5 rounded-lg border px-2.5 py-1.5 transition-colors",
        className
      )}
    />
  );
}

// Its counts come from the row context, which changes when they do.
function sameProps(a: { row: SidebarRow }, b: { row: SidebarRow }) {
  return sameRow(a.row, b.row);
}
