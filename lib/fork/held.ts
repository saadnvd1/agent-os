import { deliveryText } from "./brief";
import { getGroup, markDeliveredIds, numberOf, undelivered } from "./ledger";
import type { ChildRow } from "./types";

// A delivery as the parent's agent reads it, and as chat shows it.
export const viewOf = (parentId: string, rows: ChildRow[]) => ({
  text: deliveryText(rows, (c) => numberOf(parentId, c.child_session_id)),
  body: rows
    .map(
      (c) =>
        `Fork ${numberOf(parentId, c.child_session_id)} (${c.label}): ${c.summary ?? c.outcome}`
    )
    .join("\n"),
});

// Results that are the user's to see first: held for their next message.
export const wakes = (c: ChildRow) => getGroup(c.group_id)?.delivery !== "next";

// The user's own forks report in their next message to the parent: the
// results come first in it, then what they wrote.
export function heldForNext(parentId: string): string {
  const rows = undelivered(parentId).filter((c) => !wakes(c));
  if (!rows.length) return "";
  markDeliveredIds(rows.map((c) => c.child_session_id));
  return `${viewOf(parentId, rows).text}\n\n`;
}
