/** `aos wait children`: the parent ends its turn and is woken with results. */

import { db } from "../db";
import { numberOf, openChildren, childrenOf, undelivered } from "./ledger";
import { deliverNow } from "./deliver";

interface WaitRow {
  id: number;
  parent_session_id: string;
  mode: "all" | "any";
  created_at: number;
  deadline: number;
}

export const MAX_WAIT_MS = 24 * 60 * 60_000;
export const DEFAULT_WAIT_MS = 30 * 60_000;

export const openForkWait = (parentId: string): WaitRow | undefined =>
  db
    .prepare(
      `SELECT * FROM fork_waits WHERE parent_session_id = ? AND closed_at IS NULL`
    )
    .get(parentId) as WaitRow | undefined;

export function registerForkWait(
  parentId: string,
  mode: "all" | "any",
  timeoutMs = DEFAULT_WAIT_MS,
  now = Date.now()
): { id: number; deadline: number } | { already: string } {
  const open = childrenOf(parentId).filter((c) => c.state !== "settled");
  const waiting = undelivered(parentId);
  if (!open.length && !waiting.length)
    return { already: "you have no running forks and no unread results" };
  const deadline = now + Math.min(Math.max(timeoutMs, 60_000), MAX_WAIT_MS);
  // One wait per parent: a new one replaces it.
  db.prepare(
    `UPDATE fork_waits SET closed_at = ? WHERE parent_session_id = ? AND closed_at IS NULL`
  ).run(now, parentId);
  const { lastInsertRowid } = db
    .prepare(
      `INSERT INTO fork_waits (parent_session_id, mode, created_at, deadline) VALUES (?, ?, ?, ?)`
    )
    .run(parentId, mode, now, deadline);
  return { id: Number(lastInsertRowid), deadline };
}

const close = (id: number, now: number): boolean =>
  db
    .prepare(
      `UPDATE fork_waits SET closed_at = ? WHERE id = ? AND closed_at IS NULL`
    )
    .run(now, id).changes === 1;

export async function tickForkWaits(now = Date.now()): Promise<void> {
  const waits = db
    .prepare(`SELECT * FROM fork_waits WHERE closed_at IS NULL`)
    .all() as WaitRow[];
  for (const w of waits) {
    const ready = undelivered(w.parent_session_id);
    const open = openChildren(w.parent_session_id);
    const holds =
      w.mode === "all"
        ? open.length === 0
        : ready.length > 0 || open.length === 0;
    const timedOut = now >= w.deadline;
    if (!holds && !timedOut) continue;
    if (!close(w.id, now)) continue;
    if (!ready.length && !timedOut) continue;
    if (!ready.length) {
      const { sendChat } = await import("../chat/runner");
      await sendChat(w.parent_session_id, {
        id: `fork-w-${w.id}`,
        text: `[AgentOS: your wait on forks timed out; ${open.map((c) => numberOf(w.parent_session_id, c.child_session_id)).join(", ")} still running. \`aos children\` shows them.]`,
        queue: true,
        from: "AgentOS",
        origin: { kind: "event", label: "Forks" },
      });
      continue;
    }
    await deliverNow(w.parent_session_id, ready);
  }
}
