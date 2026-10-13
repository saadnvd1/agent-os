import { getDb } from "@/lib/db";
import { toSqliteTime } from "@/lib/session-meta";

// Marking done and snoozing are view choices like pinning: none of them
// touch updated_at. Archived sessions are out of the sidebar, so they refuse.
function update(sql: string, ...args: (string | null)[]): boolean {
  return (
    getDb()
      .prepare(`UPDATE sessions SET ${sql} AND archived_at IS NULL`)
      .run(...args).changes > 0
  );
}

export function settleSession(id: string): boolean {
  return update(
    `settled_at = datetime('now'), snoozed_until = NULL, snoozed_at = NULL
     WHERE id = ?`,
    id
  );
}

// Reopening is activity, so an auto-settled row doesn't fall back into Done.
export function reopenSession(id: string): boolean {
  return update(
    `settled_at = NULL, active_at = datetime('now') WHERE id = ?`,
    id
  );
}

export function snoozeSession(id: string, until: Date): boolean {
  return update(
    `snoozed_until = ?, snoozed_at = datetime('now'), settled_at = NULL
     WHERE id = ?`,
    toSqliteTime(until),
    id
  );
}

export function unsnoozeSession(id: string): boolean {
  return update(
    `snoozed_until = NULL, snoozed_at = NULL, active_at = datetime('now')
     WHERE id = ?`,
    id
  );
}

export const SNOOZE_MAX_MS = 60 * 24 * 3600_000;
