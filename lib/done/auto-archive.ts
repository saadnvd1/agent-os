// Done holds finished work; a session that has sat there for
// ARCHIVE_AFTER_MS with no activity is put away by itself. Never a pinned
// session, an orchestrator, one that needs input or is working, or one with
// an open PR. Mirrors the sidebar's Done placement (lib/sidebar/shelves).

import { db, type Session } from "../db";
import { fromSqliteTime } from "../session-meta";
import { statusOf } from "../orchestrator/facts";
import { statusDetector } from "../status-detector";
import { activeMs, ARCHIVE_AFTER_MS, snoozedUntil } from "../sidebar/shelves";
import { archiveSession } from "./archive";

export const AUTO_ARCHIVE_EVERY_MS = 60 * 60_000;

const ms = (t: string | null | undefined) =>
  t ? fromSqliteTime(t).getTime() : 0;

// When a Done row last changed: its last activity, or when it was marked.
function sinceMs(s: Session, now: number): number {
  return Math.max(
    activeMs(s, now),
    ms(s.settled_at),
    s.task_status ? ms(s.updated_at) : 0
  );
}

// A task is in Done once finished; a plain session that has been quiet this
// long has long since settled.
const inDone = (s: Session) =>
  !s.task_status ||
  ["merged", "dropped", "done", "moved"].includes(s.task_status);

export async function archiveStaleDone(now = Date.now()): Promise<string[]> {
  const rows = db
    .prepare(
      `SELECT * FROM sessions
       WHERE archived_at IS NULL AND pinned = 0 AND role IS NULL
         AND peer_mirror = 0 AND quick_of IS NULL
         AND (pr_status IS NULL OR pr_status != 'open')`
    )
    .all() as Session[];
  const stale = rows.filter(
    (s) =>
      now - sinceMs(s, now) >= ARCHIVE_AFTER_MS &&
      !snoozedUntil(s, now) &&
      inDone(s)
  );
  if (!stale.length) return [];
  await statusDetector.refreshCache();
  const archived: string[] = [];
  for (const s of stale) {
    const { status, needsInput } = await statusOf(s);
    if (needsInput || (status !== "idle" && status !== "dead")) continue;
    archiveSession(s.id);
    archived.push(s.id);
  }
  return archived;
}

export function startAutoArchive(): void {
  const run = () =>
    archiveStaleDone().catch((error) =>
      console.error("Archiving stale Done sessions failed:", error)
    );
  void run();
  setInterval(run, AUTO_ARCHIVE_EVERY_MS);
}
