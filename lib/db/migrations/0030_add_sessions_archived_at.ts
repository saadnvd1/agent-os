import type { Migration } from "../migration-types";

export default {
  id: 30,
  name: "add_sessions_archived_at",
  up: (db) => {
    // Done sessions leave the sidebar but are never deleted, so their
    // history and chat items stay.
    db.exec(`ALTER TABLE sessions ADD COLUMN archived_at TEXT`);
    db.exec(
      `CREATE INDEX IF NOT EXISTS idx_sessions_archived_at ON sessions(archived_at)`
    );
  },
} satisfies Migration;
