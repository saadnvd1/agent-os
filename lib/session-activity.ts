import { getDb } from "./db";

// A session did something: a message, a run starting, a need. Written at most
// once a minute, unless it wakes a snooze. Never for a settled session: what
// comes after Done (the stop's own events, a status refresh) isn't the work
// starting again. Only a prompt does that (the chat worker writes it).
export function touchActive(sessionId: string): void {
  try {
    getDb()
      .prepare(
        `UPDATE sessions SET active_at = datetime('now')
         WHERE id = ? AND (active_at IS NULL
           OR active_at < datetime('now', '-60 seconds')
           OR (snoozed_at IS NOT NULL AND active_at <= snoozed_at))
           AND (settled_at IS NULL OR active_at > settled_at)`
      )
      .run(sessionId);
  } catch (err) {
    console.error("[activity] touch failed:", err);
  }
}
