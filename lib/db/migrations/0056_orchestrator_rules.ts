import type { Migration } from "../migration-types";
import { installChangeTriggers, TABLES_WATCHED_56 } from "../changes";

export default {
  id: 56,
  name: "orchestrator_rules",
  up: (db) => {
    // Standing rules an orchestrator keeps across fresh starts
    // (lib/orchestrator/rules.ts): written by it or by Saad, never
    // deleted, only marked removed.
    db.exec(`
        CREATE TABLE IF NOT EXISTS orchestrator_rules (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          workspace_id TEXT NOT NULL,
          text TEXT NOT NULL,
          added_by TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now')),
          removed_at TEXT,
          removed_by TEXT
        )
      `);
    db.exec(
      `CREATE INDEX IF NOT EXISTS idx_orchestrator_rules
         ON orchestrator_rules(workspace_id, removed_at, id)`
    );
    // Its last worker ended the conversation at the context threshold:
    // the tokens it had reached (0 otherwise). The next one starts a new
    // one and tells the agent so.
    const columns = db.prepare(`PRAGMA table_info(sessions)`).all() as {
      name: string;
    }[];
    if (!columns.some((c) => c.name === "chat_refreshed"))
      db.exec(
        `ALTER TABLE sessions ADD COLUMN chat_refreshed INTEGER NOT NULL DEFAULT 0`
      );
    installChangeTriggers(db, TABLES_WATCHED_56);
  },
} satisfies Migration;
