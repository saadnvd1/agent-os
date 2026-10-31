import type { Migration } from "../migration-types";

export default {
  key: "20261031T1500_chat_views",
  up: (db) => {
    // Where each chat was last being read, for the person, on any device. No
    // FK to sessions, like chat_bookmarks; a trigger drops a deleted chat's row.
    // viewed_at is epoch milliseconds, the unit chat items carry.
    db.exec(`
      CREATE TABLE IF NOT EXISTS chat_views (
        session_id TEXT PRIMARY KEY,
        item_id TEXT,
        offset_px INTEGER NOT NULL DEFAULT 0,
        at_end INTEGER NOT NULL DEFAULT 1,
        viewed_at INTEGER NOT NULL
      )
    `);
    db.exec(
      `CREATE INDEX IF NOT EXISTS idx_chat_views_viewed
         ON chat_views(viewed_at DESC)`
    );
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS chat_views_session_deleted
      AFTER DELETE ON sessions
      BEGIN
        DELETE FROM chat_views WHERE session_id = OLD.id;
      END
    `);
  },
} satisfies Migration;
