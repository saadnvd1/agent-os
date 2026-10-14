import type { Migration } from "../migration-types";
import { installChangeTriggers, TABLES_WATCHED_78 } from "../changes";

export default {
  id: 78,
  name: "orchestrator_questions",
  up: (db) => {
    // A question the orchestrator put to Saad in chat, open until he
    // answers it or the orchestrator clears it. needs_you_dismissed: items
    // he hid from the Needs-you strip (an ask's or question's key); hiding
    // never resolves anything.
    db.exec(`
        CREATE TABLE IF NOT EXISTS orchestrator_questions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          workspace_id TEXT NOT NULL,
          text TEXT NOT NULL,
          task TEXT,
          status TEXT NOT NULL DEFAULT 'open',
          resolved_by TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          resolved_at TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_orchestrator_questions_open
          ON orchestrator_questions(workspace_id, status);
        CREATE TABLE IF NOT EXISTS needs_you_dismissed (
          workspace_id TEXT NOT NULL,
          key TEXT NOT NULL,
          dismissed_at TEXT NOT NULL DEFAULT (datetime('now')),
          PRIMARY KEY (workspace_id, key)
        );
      `);
    installChangeTriggers(db, TABLES_WATCHED_78);
  },
} satisfies Migration;
