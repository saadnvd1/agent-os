"use client";

import { Fragment } from "react";
import { ArrowDown, ArrowUp, Play, Trash2 } from "lucide-react";
import { toast } from "sonner";
import * as DM from "@/components/ui/dropdown-menu";
import * as CM from "@/components/ui/context-menu";
import { useQueueAction, type QueueAction } from "@/data/tasks";
import {
  queueMenu,
  queuedSubtitle,
  type QueuedRow as Row,
} from "@/lib/sidebar/queued";
import { sessionLink } from "@/lib/session-url";
import { cn } from "@/lib/utils";
import { useRowContext } from "./RowContext";
import { RowShell, type RowMenuKind } from "./RowShell";

const ITEM = { dropdown: DM.DropdownMenuItem, context: CM.ContextMenuItem };
const SEPARATOR = {
  dropdown: DM.DropdownMenuSeparator,
  context: CM.ContextMenuSeparator,
};
const icon = "mr-2 h-3.5 w-3.5";
const ICONS = { start: Play, up: ArrowUp, down: ArrowDown, remove: Trash2 };

const DONE: Record<QueueAction, string> = {
  start: "Task started",
  up: "Moved up",
  down: "Moved down",
  remove: "Removed from the queue",
};

// A task waiting to start: the same row as a task, with its place in line
// (or what it waits on) where a task's status would be. It turns into the
// task's own row when it starts.
export function QueuedRow({ row }: { row: Row }) {
  const ctx = useRowContext();
  const { item } = row;
  // Tapping the row opens the task it waits on, when that's a session here.
  const target = row.afterSessionId;
  const open = target ? () => ctx.onSelect(target) : undefined;
  const action = useQueueAction();
  const run = (a: QueueAction) =>
    action.mutate(
      { id: item.id, action: a },
      {
        onSuccess: ({ outcome }) =>
          outcome === "failed"
            ? toast.error("It could not start: see its row")
            : a !== "up" && a !== "down" && toast.success(DONE[a]),
        // The orchestrator's brakes refusing a start, or a stale row.
        onError: (error) => toast.error(error.message),
      }
    );
  const failed = item.status === "failed";
  const busy = action.isPending;

  const items = queueMenu(row);
  const menu = items.length
    ? (kind: RowMenuKind) => {
        const Item = ITEM[kind];
        const Separator = SEPARATOR[kind];
        return items.map(({ action: a, label, disabled }) => {
          const Icon = ICONS[a];
          return (
            <Fragment key={a}>
              {a === "remove" && items.length > 1 && <Separator />}
              <Item
                disabled={disabled || busy}
                onClick={() => run(a)}
                className={cn(
                  a === "remove" && "text-destructive focus:text-destructive"
                )}
              >
                <Icon className={icon} />
                {label}
              </Item>
            </Fragment>
          );
        });
      }
    : null;

  return (
    <RowShell
      title={[item.name, item.error].filter(Boolean).join("\n")}
      leading={
        <span
          aria-hidden
          className={cn(
            "h-2 w-2 shrink-0 rounded-full border",
            failed
              ? "border-destructive bg-destructive"
              : item.status === "starting"
                ? "animate-pulse border-green-500"
                : "border-muted-foreground/50 border-dashed"
          )}
        />
      }
      trailing={
        // Under the Queued heading a waiting one needs no badge.
        item.status !== "queued" && (
          <span
            className={cn(
              "rounded-md px-1.5 py-0.5 text-[11px] font-semibold",
              failed ? "text-destructive" : "bg-muted text-muted-foreground"
            )}
          >
            {failed ? "Failed" : "Starting"}
          </span>
        )
      }
      menu={menu}
      menuLabel="Queued task actions"
      onClick={open}
      onActivate={open}
    >
      <span className="text-foreground truncate text-sm">{item.name}</span>
      <QueuedSubtitle row={row} />
    </RowShell>
  );
}

function QueuedSubtitle({ row }: { row: Row }) {
  const ctx = useRowContext();
  const { item } = row;
  const { lead, after } = queuedSubtitle(item);
  const target = row.afterSessionId;
  return (
    <span
      className={cn(
        "text-muted-foreground/70 text-xs",
        // A failed start's reason is read in full, phones included.
        item.status === "failed" ? "line-clamp-3 break-words" : "truncate"
      )}
    >
      <span className={cn(item.status === "failed" && "text-destructive")}>
        {lead}
      </span>
      {after &&
        (target ? (
          <>
            {" "}
            <a
              href={sessionLink("", target)}
              onClick={(e) => {
                // The row opens it too; the link alone handles its click.
                e.stopPropagation();
                // A plain click opens it here; a modified one, a new tab.
                if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0)
                  return;
                e.preventDefault();
                ctx.onSelect(target);
              }}
              className="hover:text-foreground underline decoration-dotted underline-offset-2"
            >
              {after}
            </a>
          </>
        ) : (
          ` ${after}`
        ))}
      {item.projectName && ` · ${item.projectName}`}
    </span>
  );
}
