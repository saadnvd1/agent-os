import type { MachineGroup } from "./machines";
import { doneLimit, type Shelves, type SidebarRow } from "./shelves";

export interface ShelfFolds {
  doneCollapsed: boolean;
  snoozedCollapsed: boolean;
  donePages: number;
}

// The Snoozed and Done rows the sidebar draws: none while folded, Done cut
// to the pages shown. SessionShelves renders from this too, so the two agree.
export function shownShelves(shelves: Shelves, folds: ShelfFolds) {
  return {
    snoozed: folds.snoozedCollapsed ? [] : shelves.snoozed,
    done: folds.doneCollapsed
      ? []
      : shelves.done.slice(0, doneLimit(folds.donePages)),
  };
}

const flatten = (rows: SidebarRow[]): string[] =>
  rows.flatMap((r) => [r.session.id, ...flatten(r.workers)]);

// Session ids top to bottom, as the sidebar draws them: folded shelves are
// out, a conductor's workers follow it. The one order for switching sessions.
export function visibleSessionIds(
  shelves: Shelves,
  machines: MachineGroup[],
  folds: ShelfFolds
): string[] {
  const shown = shownShelves(shelves, folds);
  return flatten([
    ...shelves.orchestrators,
    ...shelves.pinned,
    ...shelves.needsYou,
    ...shelves.working,
    ...shelves.inReview,
    ...shelves.ongoing,
    ...shown.snoozed,
    ...shown.done,
    ...machines.flatMap((g) => g.rows),
  ]);
}

// The neighbour of `activeId` one step up (-1) or down (1); null at either
// end (no wrap), and the first or last row when nothing is active yet.
export function neighbourSession(
  ids: string[],
  activeId: string | undefined,
  step: 1 | -1
): string | null {
  if (!ids.length) return null;
  const at = activeId ? ids.indexOf(activeId) : -1;
  if (at < 0) return step === 1 ? ids[0] : ids[ids.length - 1];
  return ids[at + step] ?? null;
}
