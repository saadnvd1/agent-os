/**
 * Holding a chat still while something outside it works on its task: a
 * move to another machine (its row is 'moving'), or a Land of the stack it
 * sits in (the stack is 'landing'). Both are facts in SQLite, so the worker
 * process sees the hold too: it neither starts what's queued (queued.ts) nor
 * a turn for a message sent meanwhile, which waits in the queue instead.
 *
 * A move takes the queue with it, so it collects messages only until it has
 * packed them (collectWhileMoving). After that, until it lands or resumes
 * here, a message is refused: queued here, it would never be sent.
 */

import { db } from "../db";

// The SQL form, for queries that take the session id as @sid.
export const HELD_SQL = `(
  EXISTS (SELECT 1 FROM sessions WHERE id = @sid AND task_status = 'moving')
  OR EXISTS (SELECT 1 FROM stack_items i JOIN stacks s ON s.id = i.stack_id
             WHERE i.session_id = @sid AND s.status = 'landing')
)`;

export const isHeld = (sessionId: string): boolean =>
  !!(
    db.prepare(`SELECT ${HELD_SQL} AS held`).get({ sid: sessionId }) as {
      held: number;
    }
  ).held;

// Moves in this process still gathering what's sent, by session.
const g = globalThis as unknown as { __agentosChatCollecting?: Set<string> };
const collecting = (g.__agentosChatCollecting ??= new Set());

/**
 * From a move's start until it packs the queue: what's sent meanwhile goes
 * with the move. The returned function ends it; call it in the same tick as
 * the packing, so nothing slips in between.
 */
export function collectWhileMoving(sessionId: string): () => void {
  collecting.add(sessionId);
  return () => collecting.delete(sessionId);
}

interface HoldRow {
  task_status: string | null;
  moved_to: string | null;
  landing: number;
}

const holdRow = (sessionId: string) =>
  db
    .prepare(
      `SELECT task_status, moved_to,
         EXISTS (SELECT 1 FROM stack_items i JOIN stacks s ON s.id = i.stack_id
                 WHERE i.session_id = @sid AND s.status = 'landing') AS landing
       FROM sessions WHERE id = @sid`
    )
    .get({ sid: sessionId }) as HoldRow | undefined;

/** Why its messages wait in the queue right now, or null. */
export function chatHold(sessionId: string): string | null {
  const row = holdRow(sessionId);
  if (row?.task_status === "moving" && collecting.has(sessionId))
    return "It's sent once the move to another machine finishes";
  if (row?.landing) return "It's sent once its stack has landed";
  return null;
}

/**
 * Why nothing can be sent to it here at all: its agent runs on another
 * machine now, or its move has packed the queue and is on its way there.
 */
export function chatRefusal(sessionId: string): string | null {
  const row = holdRow(sessionId);
  const there = row?.moved_to ?? "another machine";
  if (row?.task_status === "moved")
    return `This task moved to ${there}; open it there`;
  if (row?.task_status === "moving" && !collecting.has(sessionId))
    return `It's moving to ${there}; send it there once it arrives`;
  return null;
}
