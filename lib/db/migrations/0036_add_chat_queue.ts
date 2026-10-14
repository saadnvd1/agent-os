import type { Migration } from "../migration-types";

export default {
  id: 36,
  name: "add_chat_queue",
  up: (db) => {
    // Messages written while a chat turn runs, sent in order once it ends.
    db.exec(`
        CREATE TABLE IF NOT EXISTS chat_queue (
          session_id TEXT NOT NULL,
          id TEXT NOT NULL,
          position REAL NOT NULL,
          text TEXT NOT NULL,
          images TEXT,
          image_count INTEGER NOT NULL DEFAULT 0,
          created_at INTEGER NOT NULL,
          PRIMARY KEY (session_id, id)
        )
      `);
    db.exec(
      `CREATE INDEX IF NOT EXISTS idx_chat_queue_session ON chat_queue(session_id, position)`
    );
    // The agent's guess at the next message, shown in an empty composer.
    db.exec(`ALTER TABLE sessions ADD COLUMN chat_suggestion TEXT`);
  },
} satisfies Migration;
