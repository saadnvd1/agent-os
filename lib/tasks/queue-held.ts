/**
 * Messages for a task still in the start queue. They're ordinary bus
 * messages addressed to the queue id (the id the task starts as), flagged
 * held_queued, and reach the task in its first prompt (tasks/start.ts).
 * Nothing is deleted: a delivered or discarded message is marked, like the
 * ones held for a paused task.
 *
 * Light on purpose: the message bus imports this, and must not pull in the
 * queue's scheduler.
 */

import { db } from "../db";
import type { HeldMessage } from "./pause-policy";

export function queuedLabel(r: { name: string | null; prompt: string }) {
  if (r.name) return r.name;
  const line = r.prompt.split("\n")[0].trim();
  return line.length > 60 ? `${line.slice(0, 57)}...` : line;
}

export interface QueuedTarget {
  id: string;
  name: string;
  status: string;
  error: string | null;
}

// A task waiting to start (or failed to) by id, id prefix of 4+ characters
// or name; in one workspace when given.
export function findQueuedTarget(
  ref: string,
  opts: { workspaceId?: string } = {}
): QueuedTarget | null {
  const want = ref.trim();
  if (!want) return null;
  const rows = db
    .prepare(
      `SELECT q.id, q.name, q.prompt, q.status, q.error, p.name AS project
       FROM task_queue q JOIN projects p ON p.id = q.project_id
       WHERE q.status IN ('queued', 'starting', 'failed')
         ${opts.workspaceId ? "AND p.workspace_id = @ws" : ""}`
    )
    .all(opts.workspaceId ? { ws: opts.workspaceId } : {}) as {
    id: string;
    name: string | null;
    prompt: string;
    status: string;
    error: string | null;
    project: string;
  }[];
  const lower = want.toLowerCase();
  const hits = rows.filter((r) => {
    const name = queuedLabel(r).toLowerCase();
    return (
      r.id === want ||
      (want.length >= 4 && r.id.startsWith(want)) ||
      name === lower ||
      `${r.project}/${name}`.toLowerCase() === lower
    );
  });
  if (hits.length > 1)
    throw new Error(
      `"${ref}" matches ${hits.length} queued tasks: ${hits.map((h) => `${queuedLabel(h)} (${h.id.slice(0, 8)})`).join(", ")}`
    );
  const r = hits[0];
  return r
    ? { id: r.id, name: queuedLabel(r), status: r.status, error: r.error }
    : null;
}

// Refuses a task that failed to start: nothing will ever start it.
export function assertTakesMessages(q: QueuedTarget): void {
  if (q.status === "failed")
    throw new Error(
      `${q.name} failed to start${q.error ? ` (${q.error})` : ""}; it takes no messages. Remove it and queue it again.`
    );
}

export const heldQueuedNote = (name: string) =>
  `Queued for ${name}: it hasn't started; it gets this when it starts.`;

const UNDELIVERED = `held_queued = 1 AND delivered_at IS NULL AND read_at IS NULL`;

export function queuedHeldMessages(id: string): HeldMessage[] {
  return (
    db
      .prepare(
        `SELECT from_name, body FROM bus_messages
         WHERE to_id = ? AND ${UNDELIVERED} ORDER BY id`
      )
      .all(id) as { from_name: string; body: string }[]
  ).map((r) => ({ from: r.from_name, text: r.body }));
}

// They're in the first prompt: delivered, and not for `aos inbox` again.
export function markQueuedHeldDelivered(id: string): void {
  db.prepare(
    `UPDATE bus_messages
     SET delivered_at = datetime('now'), read_at = COALESCE(read_at, datetime('now'))
     WHERE to_id = ? AND ${UNDELIVERED}`
  ).run(id);
}

// The task left the queue without starting.
export function discardQueuedHeld(id: string): void {
  db.prepare(
    `UPDATE bus_messages SET read_at = datetime('now')
     WHERE to_id = ? AND ${UNDELIVERED}`
  ).run(id);
}

export function queuedMessagesSection(held: HeldMessage[]): string {
  if (!held.length) return "";
  return `\n\n## Messages while queued\nThese arrived before you started, oldest first. They are part of your instructions:\n${held.map((m, i) => `${i + 1}. From ${m.from}: ${m.text}`).join("\n")}`;
}
