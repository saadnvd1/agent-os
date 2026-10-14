// Whether a session is paused, from the database alone, so the message bus
// can hold a message for it without loading the pause machinery.

import { db, type TaskPause } from "../db";

export interface PauseHold {
  pauseId: number;
  until: string | null;
}

export function pauseHoldOf(sessionId: string): PauseHold | null {
  const row = db
    .prepare(
      `SELECT pause_id, paused_until FROM sessions
       WHERE id = ? AND pause_state IN ('pausing', 'paused') AND pause_id IS NOT NULL`
    )
    .get(sessionId) as
    | { pause_id: number; paused_until: string | null }
    | undefined;
  return row ? { pauseId: row.pause_id, until: row.paused_until } : null;
}

// A stored time (UTC, no zone) as this server's clock reads it.
export function formatUntil(stored: string): string {
  const t = Date.parse(`${stored.replace(" ", "T")}Z`);
  return new Date(t).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

// What a sender is told when their message is held.
export function pausedNote(name: string, hold: PauseHold): string {
  return `${name} is paused${hold.until ? ` until ${formatUntil(hold.until)}` : ""}; it gets this when it resumes`;
}

export function endPause(
  row: Pick<TaskPause, "id" | "session_id">,
  reason: "resumed" | "cancelled" | "finished"
): void {
  db.transaction(() => {
    db.prepare(
      `UPDATE task_pauses SET state = 'ended', ended_at = datetime('now'), end_reason = ?
       WHERE id = ? AND state != 'ended'`
    ).run(reason, row.id);
    db.prepare(
      `UPDATE sessions SET pause_state = NULL, paused_until = NULL, pause_id = NULL
       WHERE id = ? AND pause_id = ?`
    ).run(row.session_id, row.id);
  })();
}

// A task that merged, was dropped or was marked done is no longer paused.
// What was held stays as history, read.
export function endPauseOnFinish(sessionId: string): void {
  const row = db
    .prepare(
      `SELECT id, session_id FROM task_pauses WHERE session_id = ? AND state != 'ended'
       ORDER BY id DESC LIMIT 1`
    )
    .get(sessionId) as { id: number; session_id: string } | undefined;
  if (!row) return;
  endPause(row, "finished");
  db.prepare(
    `UPDATE bus_messages SET read_at = COALESCE(read_at, datetime('now'))
     WHERE held_pause_id = ?`
  ).run(row.id);
}
