/**
 * A task its orchestrator moved here has no orchestrator on this machine to
 * message, and this machine never reaches back to the one that holds it. Its
 * message to the orchestrator is only stored here (relay_state 'pending');
 * the holder pulls it (lib/tasks/held-replies.ts) and delivers it there as
 * that task's own. This machine never delivers or attributes it, and the
 * holder, not the sender, says who receives it.
 */

import { db, type Session } from "../db";
import { resolveRef } from "./resolve";

export interface HeldOrchestrator {
  id: string;
  name: string;
  heldFrom: string;
}

/** The orchestrator a running held task messages, or null. */
export function heldOrchestrator(
  s: Session | undefined
): HeldOrchestrator | null {
  if (
    !s ||
    !s.held_by_device ||
    !s.held_for ||
    !s.held_for_name ||
    s.task_status !== "running"
  )
    return null;
  return {
    id: s.held_for,
    name: s.held_for_name,
    heldFrom: s.held_from || "another machine",
  };
}

/** The orchestrator `ref` names for this held sender: its name, id prefix or "orchestrator". */
export function heldTarget(
  from: Session | undefined,
  ref: string
): HeldOrchestrator | null {
  const o = from && heldOrchestrator(from);
  if (!o) return null;
  if (ref.trim().toLowerCase() === "orchestrator") return o;
  const r = resolveRef(ref, [
    {
      id: o.id,
      name: o.name,
      projectName: null,
      tmuxName: "",
      previousNames: [],
    },
  ]);
  return r.ok ? o : null;
}

export interface PendingReply {
  id: number;
  fromId: string;
  body: string;
  createdAt: string;
}

/** What the calling device's held tasks have said to their orchestrators. */
export function pendingReplies(device: string, limit = 50): PendingReply[] {
  return (
    db
      .prepare(
        `SELECT m.id, m.from_id AS fromId, m.body, m.created_at AS createdAt
         FROM bus_messages m JOIN sessions s ON s.id = m.from_id
         WHERE m.relay_state = 'pending' AND s.held_by_device = ?
         ORDER BY m.id LIMIT ?`
      )
      .all(device, limit) as PendingReply[]
  ).map((r) => ({ ...r, id: Number(r.id) }));
}

/** Marks them pulled; only the device's own are touched. */
export function ackReplies(device: string, ids: number[]): void {
  const mark = db.prepare(
    `UPDATE bus_messages SET relay_state = 'relayed', delivered_at = datetime('now')
     WHERE id = ? AND relay_state = 'pending'
       AND from_id IN (SELECT id FROM sessions WHERE held_by_device = ?)`
  );
  db.transaction(() => {
    for (const id of ids) mark.run(id, device);
  })();
}
