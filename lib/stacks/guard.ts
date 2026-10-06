import { db, stackQueries as q, type StackItemRow } from "../db";

export const itemName = (item: Pick<StackItemRow, "ticket" | "title">) =>
  item.ticket || item.title;

// Why a stacked item cannot merge yet, or null. Pure: the parent's branch is
// passed in, so "still sits on the parent" is a string comparison.
export function refusalFor(
  item: StackItemRow,
  parent: StackItemRow | null,
  parentBranch: string | null
): string | null {
  if (!parent) return null;
  const who = itemName(parent);
  if (parent.status !== "merged") {
    const state =
      parent.status === "pr" ? "has not merged" : `is ${parent.status}`;
    return `${itemName(item)} is stacked on ${who}, which ${state}. A stack merges bottom-up: sign off ${who} first.`;
  }
  if (parentBranch && item.base_branch === parentBranch) {
    const fix = item.error ? ` ${item.error}` : "";
    return `${who} has merged, but ${itemName(item)} was never moved off its branch.${fix}`;
  }
  return null;
}

export function parentBranchOf(parent: StackItemRow | null): string | null {
  if (!parent?.session_id) return null;
  const row = db
    .prepare(`SELECT branch_name FROM sessions WHERE id = ?`)
    .get(parent.session_id) as { branch_name: string | null } | undefined;
  return row?.branch_name ?? null;
}

export function signOffRefusal(sessionId: string): string | null {
  const item = q.itemForSession(db, sessionId);
  if (!item?.parent_item_id) return null;
  const parent = q.item(db, item.parent_item_id);
  return item && refusalFor(item, parent, parentBranchOf(parent));
}

// Items stacked directly on this task that are still open.
export function liveChildren(sessionId: string): StackItemRow[] {
  const item = q.itemForSession(db, sessionId);
  if (!item) return [];
  return q
    .items(db, item.stack_id)
    .filter(
      (i) =>
        i.parent_item_id === item.id &&
        (i.status === "starting" || i.status === "running" || i.status === "pr")
    );
}
