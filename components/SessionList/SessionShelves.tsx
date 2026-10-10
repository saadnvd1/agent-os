"use client";

import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { DONE_PAGE, doneLimit, type Shelves } from "@/lib/sidebar/shelves";
import type { MachineGroup } from "@/lib/sidebar/machines";
import { sidebarUiActions } from "@/stores/sidebarUi";
import { cn } from "@/lib/utils";
import { SessionRow } from "./SessionRow";
import { OrchestratorPinRow, OrchestratorStartRow } from "./OrchestratorPinRow";
import { QueuedRow } from "./QueuedRow";
import type { QueuedRow as QueuedRowData } from "@/lib/sidebar/queued";

function ShelfLabel({
  label,
  count,
  collapsed,
  onToggle,
}: {
  label: string;
  count?: number;
  collapsed?: boolean;
  onToggle?: () => void;
}) {
  const text = (
    <>
      {label}
      {count !== undefined && ` · ${count}`}
      {onToggle && (
        <ChevronDown
          className={cn(
            "h-3 w-3 transition-transform",
            collapsed && "-rotate-90"
          )}
        />
      )}
    </>
  );
  const cls =
    "text-muted-foreground/70 flex items-center gap-1 px-2.5 pt-3.5 pb-1.5 text-[11px] font-medium tracking-[0.08em] uppercase";
  return onToggle ? (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={!collapsed}
      className={cn(cls, "hover:text-foreground min-h-11 w-full md:min-h-8")}
    >
      {text}
    </button>
  ) : (
    <div className={cls}>{text}</div>
  );
}

function Shelf({
  label,
  count,
  children,
}: {
  label: string;
  count?: number;
  children: ReactNode;
}) {
  return (
    <section aria-label={label}>
      <ShelfLabel label={label} count={count} />
      {children}
    </section>
  );
}

// A linked machine's sessions no project here holds, under its name.
export function MachineShelves({ groups }: { groups: MachineGroup[] }) {
  return groups.map((g) => (
    <Shelf key={g.hostId} label={g.name} count={g.rows.length}>
      {g.rows.map((r) => (
        <SessionRow key={r.session.id} row={r} />
      ))}
    </Shelf>
  ));
}

// The pinned orchestrator (or a row to start one), then Pinned, Needs you,
// Working, Queued and Done: once for the whole list.
export function SessionShelves({
  shelves,
  queued,
  toStart,
  doneCollapsed,
  donePages,
}: {
  shelves: Shelves;
  queued: QueuedRowData[];
  toStart: { workspaceId: string; name: string }[];
  doneCollapsed: boolean;
  donePages: number;
}) {
  const shown = shelves.done.slice(0, doneLimit(donePages));
  const hidden = shelves.done.length - shown.length;
  return (
    <>
      {shelves.orchestrators.length + toStart.length > 0 && (
        <section aria-label="Orchestrator" className="space-y-1 pt-2">
          {shelves.orchestrators.map((r) => (
            <OrchestratorPinRow key={r.session.id} row={r} />
          ))}
          {toStart.map((w) => (
            <OrchestratorStartRow key={w.workspaceId} {...w} />
          ))}
        </section>
      )}
      {shelves.pinned.length > 0 && (
        <Shelf label="Pinned">
          {shelves.pinned.map((r) => (
            <SessionRow key={r.session.id} row={r} />
          ))}
        </Shelf>
      )}
      {shelves.needsYou.length > 0 && (
        <Shelf label="Needs you" count={shelves.needsYou.length}>
          {shelves.needsYou.map((r) => (
            <SessionRow key={r.session.id} row={r} />
          ))}
        </Shelf>
      )}
      {shelves.working.length > 0 && (
        <Shelf label="Working" count={shelves.working.length}>
          {shelves.working.map((r) => (
            <SessionRow key={r.session.id} row={r} />
          ))}
        </Shelf>
      )}
      {queued.length > 0 && (
        <Shelf label="Queued" count={queued.length}>
          {queued.map((r) => (
            <QueuedRow key={r.item.id} row={r} />
          ))}
        </Shelf>
      )}
      {shelves.done.length > 0 && (
        <section aria-label="Done">
          <ShelfLabel
            label="Done"
            collapsed={doneCollapsed}
            onToggle={sidebarUiActions.toggleDone}
          />
          {!doneCollapsed &&
            shown.map((r) => <SessionRow key={r.session.id} row={r} muted />)}
          {!doneCollapsed && hidden > 0 && (
            <button
              type="button"
              onClick={sidebarUiActions.showMoreDone}
              className="text-muted-foreground hover:text-foreground min-h-11 px-2.5 text-left text-[13px] md:min-h-9"
            >
              Show {Math.min(hidden, DONE_PAGE)} more
            </button>
          )}
        </section>
      )}
    </>
  );
}
