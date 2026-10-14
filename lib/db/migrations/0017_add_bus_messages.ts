import type { Migration } from "../migration-types";

export default {
  id: 17,
  name: "add_bus_messages",
  up: (db) => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS bus_messages (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          from_id TEXT,
          from_name TEXT NOT NULL,
          to_id TEXT NOT NULL,
          to_name TEXT NOT NULL,
          body TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          delivered_at TEXT,
          read_at TEXT
        )
      `);
    db.exec(
      `CREATE INDEX IF NOT EXISTS idx_bus_to ON bus_messages(to_id, read_at)`
    );
  },
} satisfies Migration;
