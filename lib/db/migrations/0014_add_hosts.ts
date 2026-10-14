import type { Migration } from "../migration-types";

export default {
  id: 14,
  name: "add_hosts",
  up: (db) => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS hosts (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          ssh_target TEXT NOT NULL,
          sort_order INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
      `);
    db.exec(
      `ALTER TABLE projects ADD COLUMN host_id TEXT NOT NULL DEFAULT 'local'`
    );
    db.exec(
      `ALTER TABLE sessions ADD COLUMN host_id TEXT NOT NULL DEFAULT 'local'`
    );
  },
} satisfies Migration;
