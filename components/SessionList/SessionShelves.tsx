"use client";

import type { ReactNode } from "react";
import { ChevronDown, ListTodo, Server, type LucideIcon } from "lucide-react";
import {
  DONE_PAGE,
  doneLimit,
  doneSummary,
  type Shelves,
} from "@/lib/sidebar/shelves";
import { shownShelves } from "@/lib/sidebar/visible-order";
import type { MachineGroup } from "@/lib/sidebar/machines";
import { sidebarUiActions } from "@/stores/sidebarUi";
import { cn } from "@/lib/utils";
import { usePendingCardSessions } from "@/data/learning-cards";
import { SessionRow } from "./SessionRow";
import { GroupShelves } from "./GroupShelves";
import { OrchestratorPinRow, OrchestratorStartRow } from "./OrchestratorPinRow";
import { QueuedRow } from "./QueuedRow";
import type { QueuedRow as QueuedRowData } from "@/lib/sidebar/queued";

// A shelf's header. Only groups that aren't a state (a machine, the line,
// terminals) carry an icon; a shelf that asks for you counts in amber.
export function ShelfLabel({
  label,
  count,
  icon: Icon,
  accent = false,
  collapsed,
  onToggle,
}: {
  label: string;
  count?: number;
  icon?: LucideIcon;
  accent?: boolean;
  collapsed?: boolean;
  onToggle?: () => void;
}) {
  const text = (
    <>
      {Icon && <Icon aria-hidden className="h-3 w-3 shrink-0" />}
      {label}
      {count !== undefined && (
        <>
          {" · "}
          <span className={cn(accent && "text-amber-600 dark:text-amber-400")}>
            {count}
          </span>
        </>
      )}
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
      className={cn(
        cls,
        "hover:text-foreground min-h-11 w-full md:min-h-8 [@media(hover:none)]:md:min-h-11"
      )}
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
  icon,
  accent,
  children,
}: {
  label: string;
  count?: number;
  icon?: LucideIcon;
  accent?: boolean;
  children: ReactNode;
}) {
  return (
    <section aria-label={label}>
      <ShelfLabel label={label} count={count} icon={icon} accent={accent} />
      {children}
    </section>
  );
}

// A linked machine's sessions no project here holds, under its name.
export function MachineShelves({ groups }: { groups: MachineGroup[] }) {
  return groups.map((g) => (
    <Shelf key={g.hostId} label={g.name} count={g.rows.length} icon={Server}>
      {g.rows.map((r) => (
        <SessionRow key={r.session.id} row={r} inMachineShelf />
      ))}
    </Shelf>
  ));
}

// The pinned orchestrator (or a row to start one), then Pinned, Needs you,
// Working, In review, Queued, Ongoing, Snoozed and Done: once for the whole list.
export function SessionShelves({
  shelves,
  queued,
  toStart,
  doneCollapsed,
  snoozedCollapsed,
  donePages,
  workspaceNames,
}: {
  shelves: Shelves;
  queued: QueuedRowData[];
  toStart: { workspaceId: string; name: string }[];
  doneCollapsed: boolean;
  snoozedCollapsed: boolean;
  donePages: number;
  workspaceNames?: Map<string, string>;
}) {
  const folds = { doneCollapsed, snoozedCollapsed, donePages };
  const shown = shelves.done.slice(0, doneLimit(donePages));
  const hidden = shelves.done.length - shown.length;
  const visible = shownShelves(shelves, folds);
  const pendingCards = usePendingCardSessions();
  const doneCards = shelves.done.reduce(
    (n, r) => n + (pendingCards.get(r.session.id) ?? 0),
    0
  );
  const summary =
    doneSummary(shelves.done).text +
    (doneCards ? ` · ${doneCards} card${doneCards > 1 ? "s" : ""}` : "");
  // Live work above, what's resting below a hairline.
  const live =
    shelves.orchestrators.length +
      toStart.length +
      shelves.pinned.length +
      shelves.groups.length +
      shelves.needsYou.length +
      shelves.working.length +
      shelves.inReview.length +
      queued.length +
      shelves.ongoing.length >
    0;
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
      <GroupShelves groups={shelves.groups} workspaceNames={workspaceNames} />
      {shelves.needsYou.length > 0 && (
        <Shelf label="Needs you" count={shelves.needsYou.length} accent>
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
      {shelves.inReview.length > 0 && (
        <Shelf label="In review" count={shelves.inReview.length}>
          {shelves.inReview.map((r) => (
            <SessionRow key={r.session.id} row={r} />
          ))}
        </Shelf>
      )}
      {queued.length > 0 && (
        <Shelf label="Queued" count={queued.length} icon={ListTodo}>
          {queued.map((r) => (
            <QueuedRow key={r.item.id} row={r} />
          ))}
        </Shelf>
      )}
      {shelves.ongoing.length > 0 && (
        <Shelf label="Ongoing" count={shelves.ongoing.length}>
          {shelves.ongoing.map((r) => (
            <SessionRow key={r.session.id} row={r} />
          ))}
        </Shelf>
      )}
      {live && shelves.snoozed.length + shelves.done.length > 0 && (
        <div aria-hidden className="border-border mx-2.5 mt-2.5 border-t" />
      )}
      {shelves.snoozed.length > 0 && (
        <section aria-label="Snoozed">
          <ShelfLabel
            label="Snoozed"
            count={shelves.snoozed.length}
            collapsed={snoozedCollapsed}
            onToggle={sidebarUiActions.toggleSnoozed}
          />
          {visible.snoozed.map((r) => (
            <SessionRow key={r.session.id} row={r} muted />
          ))}
        </section>
      )}
      {shelves.done.length > 0 && (
        <section aria-label="Done">
          <ShelfLabel
            label={doneCollapsed ? summary : "Done"}
            collapsed={doneCollapsed}
            onToggle={sidebarUiActions.toggleDone}
          />
          {visible.done.map((r) => (
            <SessionRow key={r.session.id} row={r} muted />
          ))}
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
