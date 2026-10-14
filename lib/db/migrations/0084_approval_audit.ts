import type { Migration } from "../migration-types";

export default {
  id: 84,
  name: "approval_audit",
  up: (db) => {
    // Every approval No approvals mode made in place of a person.
    db.exec(`
        CREATE TABLE IF NOT EXISTS approval_audit (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          at TEXT NOT NULL DEFAULT (datetime('now')),
          source TEXT NOT NULL,
          workspace_id TEXT,
          session_id TEXT,
          subject TEXT NOT NULL,
          detail TEXT NOT NULL DEFAULT ''
        )
      `);
  },
} satisfies Migration;
