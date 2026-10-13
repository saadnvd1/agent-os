import { getDb } from "./db";

// A session did something: a message, a run starting, a need. Written at most
// once a minute, unless it wakes a snooze or brings a settled session back.
export function touchActive(sessionId: string): void {
  try {
    getDb()
      .prepare(
        `UPDATE sessions SET active_at = datetime('now')
         WHERE id = ? AND (active_at IS NULL
           OR active_at < datetime('now', '-60 seconds')
           OR (snoozed_at IS NOT NULL AND active_at <= snoozed_at)
           OR (settled_at IS NOT NULL AND active_at <= settled_at))`
      )
      .run(sessionId);
  } catch (err) {
    console.error("[activity] touch failed:", err);
  }
}
