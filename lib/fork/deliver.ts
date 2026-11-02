/**
 * Handing results to the parent. They arrive as one message at a turn
 * boundary (queued behind a running turn, waking an idle one), batched so
 * a burst of children is one wake. Each delivery is claimed in the ledger
 * under an id before it is sent, and the chat takes a repeated id as a
 * no-op, so a crash between the two sends it once.
 */

import { randomUUID } from "crypto";
import { db, queries, type Session } from "../db";
import { sendChat } from "../chat/runner";
import {
  claimDelivery,
  markDelivered,
  openChildren,
  parentsWithUndelivered,
  undelivered,
  unsettledWithDelivery,
} from "./ledger";
import { FORK_LIMITS } from "./options";
import { openForkWait } from "./waits";
import { viewOf, wakes } from "./held";
import type { ChildRow } from "./types";

const sessionOf = (id: string) =>
  queries.getSession(db).get(id) as Session | undefined;

async function send(parentId: string, deliveryId: string, rows: ChildRow[]) {
  const parent = sessionOf(parentId);
  if (!parent || parent.archived_at) return;
  const { text, body } = viewOf(parentId, rows);
  await sendChat(parentId, {
    id: deliveryId,
    text,
    queue: true,
    from: "AgentOS",
    origin: { kind: "event", label: "Forks", body },
  });
  markDelivered(deliveryId);
}

// Whether this batch has gathered long enough: quiet for the window, or
// the first one has waited the cap, or nothing else is still running.
function due(parentId: string, rows: ChildRow[], now: number): boolean {
  if (!openChildren(parentId).length) return true;
  const times = rows.map((c) => c.settled_at ?? now);
  return (
    now - Math.max(...times) >= FORK_LIMITS.batchWindowMs ||
    now - Math.min(...times) >= FORK_LIMITS.batchCapMs
  );
}

export async function deliverDue(now = Date.now()): Promise<void> {
  for (const parentId of parentsWithUndelivered()) {
    try {
      // Sent but not marked: the same id again.
      const claimed = unsettledWithDelivery(parentId);
      if (claimed) {
        await send(parentId, claimed, claimDelivery([], claimed));
        continue;
      }
      // A wait delivers its own when it holds.
      if (openForkWait(parentId)) continue;
      const rows = undelivered(parentId).filter(wakes);
      if (!rows.length || !due(parentId, rows, now)) continue;
      const id = `fork-d-${randomUUID().slice(0, 8)}`;
      await send(
        parentId,
        id,
        claimDelivery(
          rows.map((c) => c.child_session_id),
          id
        )
      );
    } catch (error) {
      console.error(`[forks] delivery to ${parentId}:`, error);
    }
  }
}

// Sends these right now (a wait that held), marking them so the tick
// doesn't send them again.
export async function deliverNow(parentId: string, rows: ChildRow[]) {
  if (!rows.length) return;
  const id = `fork-d-${randomUUID().slice(0, 8)}`;
  const claimed = claimDelivery(
    rows.map((c) => c.child_session_id),
    id
  );
  if (claimed.length) await send(parentId, id, claimed);
}
