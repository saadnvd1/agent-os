import type { Migration } from "../migration-types";

export default {
  id: 23,
  name: "mark_existing_sessions_seen",
  up: (db) => {
    // Start quiet: what finished before "needs you" meant news is old news.
    db.exec(
      `UPDATE sessions SET last_seen_at = datetime('now') WHERE last_seen_at IS NULL`
    );
  },
} satisfies Migration;
