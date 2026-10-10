/**
 * Holding a chat still while something outside it works on its task: a
 * move to another machine (its row is 'moving'), or a Land of the stack it
 * sits in (the stack is 'landing'). Both are facts in SQLite, so the worker
 * process sees the hold too: it doesn't start what's queued (queued.ts),
 * and whatever is sent meanwhile waits in the queue rather than starting a
 * turn.
 */

import { db } from "../db";

// The SQL form, for queries that take the session id as @sid.
export const HELD_SQL = `(
  EXISTS (SELECT 1 FROM sessions WHERE id = @sid AND task_status = 'moving')
  OR EXISTS (SELECT 1 FROM stack_items i JOIN stacks s ON s.id = i.stack_id
             WHERE i.session_id = @sid AND s.status = 'landing')
)`;

/** Why its messages wait in the queue right now, or null. */
export function chatHold(sessionId: string): string | null {
  const row = db
    .prepare(
      `SELECT task_status,
         EXISTS (SELECT 1 FROM stack_items i JOIN stacks s ON s.id = i.stack_id
                 WHERE i.session_id = @sid AND s.status = 'landing') AS landing
       FROM sessions WHERE id = @sid`
    )
    .get({ sid: sessionId }) as
    | { task_status: string | null; landing: number }
    | undefined;
  if (row?.task_status === "moving")
    return "It's sent once the move to another machine finishes";
  if (row?.landing) return "It's sent once its stack has landed";
  return null;
}

/** A task handed to another machine: its agent runs there now. */
export function movedAway(sessionId: string): string | null {
  const row = db
    .prepare(`SELECT task_status, moved_to FROM sessions WHERE id = ?`)
    .get(sessionId) as
    | { task_status: string | null; moved_to: string | null }
    | undefined;
  return row?.task_status === "moved"
    ? `This task moved to ${row.moved_to ?? "another machine"}; open it there`
    : null;
}
