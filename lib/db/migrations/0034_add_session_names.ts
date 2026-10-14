import type { Migration } from "../migration-types";

export default {
  id: 34,
  name: "add_session_names",
  up: (db) => {
    // Names a session had before it was renamed, so a message sent to
    // an old name still reaches it.
    db.exec(`
        CREATE TABLE IF NOT EXISTS session_names (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          session_id TEXT NOT NULL,
          name TEXT NOT NULL,
          renamed_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
      `);
    db.exec(
      `CREATE INDEX IF NOT EXISTS idx_session_names_session ON session_names(session_id)`
    );
  },
} satisfies Migration;
