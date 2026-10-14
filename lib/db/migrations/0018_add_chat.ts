import type { Migration } from "../migration-types";

export default {
  id: 18,
  name: "add_chat",
  up: (db) => {
    db.exec(
      `ALTER TABLE sessions ADD COLUMN view TEXT NOT NULL DEFAULT 'terminal'`
    );
    db.exec(`
        CREATE TABLE IF NOT EXISTS chat_items (
          session_id TEXT NOT NULL,
          item_id TEXT NOT NULL,
          seq INTEGER NOT NULL,
          data TEXT NOT NULL,
          PRIMARY KEY (session_id, item_id)
        )
      `);
    db.exec(
      `CREATE INDEX IF NOT EXISTS idx_chat_items_seq ON chat_items(session_id, seq)`
    );
  },
} satisfies Migration;
