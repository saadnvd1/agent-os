import type Database from "better-sqlite3";
import type { PartPatch } from "./columns";
import { writePart, type When } from "./write";

// A task's brief, status, priority, models and card: lib/db/session-parts/columns.ts.
export const setTask = (
  db: Database.Database,
  sessionId: string,
  patch: PartPatch<"session_tasks">,
  when?: When<"session_tasks">
): boolean => writePart(db, "session_tasks", sessionId, patch, when);

// The task's first start, kept across moves: set once, from created_at when
// the caller has no better time.
export function startTaskClock(
  db: Database.Database,
  sessionId: string,
  at?: string | null
): void {
  const row = db
    .prepare(`SELECT created_at, task_since FROM session_rows WHERE id = ?`)
    .get(sessionId) as
    | { created_at: string; task_since: string | null }
    | undefined;
  if (!row || row.task_since) return;
  setTask(db, sessionId, { task_since: at ?? row.created_at });
}
