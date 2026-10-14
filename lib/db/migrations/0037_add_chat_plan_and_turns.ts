import type { Migration } from "../migration-types";

export default {
  id: 37,
  name: "add_chat_plan_and_turns",
  // One transaction, so a crash part-way leaves nothing to skip as
  // "duplicate column" on the next start.
  up: (db) =>
    db.transaction(() => {
      // Plan mode is remembered per session; the context meter's last
      // reading survives a reload; and the agent's running totals at its
      // last turn tell what the next turn added.
      db.exec(
        `ALTER TABLE sessions ADD COLUMN chat_plan INTEGER NOT NULL DEFAULT 0`
      );
      db.exec(`ALTER TABLE sessions ADD COLUMN chat_context TEXT`);
      db.exec(`ALTER TABLE sessions ADD COLUMN chat_usage TEXT`);
      // What each chat turn cost, kept with the session's name and
      // workspace so the history outlives the session.
      db.exec(`
        CREATE TABLE IF NOT EXISTS chat_turns (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          session_id TEXT NOT NULL,
          session_name TEXT NOT NULL,
          workspace_id TEXT,
          at INTEGER NOT NULL,
          cost_usd REAL NOT NULL,
          input_tokens INTEGER NOT NULL,
          output_tokens INTEGER NOT NULL,
          cache_read_tokens INTEGER NOT NULL,
          cache_write_tokens INTEGER NOT NULL
        )
      `);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_chat_turns_at ON chat_turns(at)`);
      db.exec(
        `CREATE INDEX IF NOT EXISTS idx_chat_turns_session ON chat_turns(session_id, id)`
      );
    })(),
} satisfies Migration;
