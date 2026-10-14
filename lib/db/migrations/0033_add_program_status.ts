import type { Migration } from "../migration-types";

export default {
  id: 33,
  name: "add_program_status",
  up: (db) => {
    // What programs in a terminal report about themselves (OSC 7501),
    // by tmux session: kept so a restart doesn't forget a finished or
    // blocked session.
    db.exec(`
        CREATE TABLE IF NOT EXISTS program_status (
          session_name TEXT PRIMARY KEY,
          records TEXT NOT NULL,
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
      `);
  },
} satisfies Migration;
