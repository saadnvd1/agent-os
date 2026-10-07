import { getDb } from "@/lib/db";

// Pinning is a view choice: it doesn't touch updated_at, so the session
// keeps its place in time and its unread state.
export function setPinned(sessionId: string, pinned: boolean): boolean {
  return (
    getDb()
      .prepare(`UPDATE sessions SET pinned = ? WHERE id = ?`)
      .run(pinned ? 1 : 0, sessionId).changes > 0
  );
}
