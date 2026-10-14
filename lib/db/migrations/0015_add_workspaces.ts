import type { Migration } from "../migration-types";

export default {
  id: 15,
  name: "add_workspaces",
  up: (db) => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS workspaces (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          sort_order INTEGER NOT NULL DEFAULT 0,
          collapsed INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
      `);
    db.exec(`ALTER TABLE projects ADD COLUMN workspace_id TEXT`);
  },
} satisfies Migration;
