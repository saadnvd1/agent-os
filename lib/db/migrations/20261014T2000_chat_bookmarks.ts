import type { Migration } from "../migration-types";
import {
  installChangeTriggers,
  TABLES_WATCHED_CHAT_BOOKMARKS,
} from "../changes";

export default {
  key: "20261014T2000_chat_bookmarks",
  up: (db) => {
    // A person's marks on single chat items. No FK to sessions: a
    // bookmark outlives a deleted chat with its own snapshot. Additive.
    db.exec(`
        CREATE TABLE IF NOT EXISTS chat_bookmarks (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          item_id TEXT NOT NULL,
          scope TEXT NOT NULL DEFAULT 'item',
          workspace_id TEXT,
          kind TEXT NOT NULL,
          text TEXT NOT NULL,
          session_name TEXT NOT NULL,
          note TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          UNIQUE (session_id, item_id, scope)
        )
      `);
    db.exec(
      `CREATE INDEX IF NOT EXISTS idx_chat_bookmarks_ws
           ON chat_bookmarks(workspace_id, created_at DESC)`
    );
    installChangeTriggers(db, TABLES_WATCHED_CHAT_BOOKMARKS);
  },
} satisfies Migration;
