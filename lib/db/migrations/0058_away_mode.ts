import type { Migration } from "../migration-types";
import { installChangeTriggers, TABLES_WATCHED_58 } from "../changes";

export default {
  id: 58,
  name: "away_mode",
  up: (db) => {
    // Saad's Away mode (lib/away): one row per time he stepped away. The
    // report is built from the database when it ends and kept here.
    db.exec(`
        CREATE TABLE IF NOT EXISTS away_periods (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          set_by TEXT NOT NULL,
          started_at TEXT NOT NULL DEFAULT (datetime('now')),
          expires_at TEXT,
          ended_at TEXT,
          ended_by TEXT,
          last_sweep_at TEXT,
          asks_notified_at TEXT,
          report TEXT,
          report_seen_at TEXT
        )
      `);
    // What the away sweep did, once per key per period: a nudge, a
    // request to commit, a review run again, a deploy checked.
    db.exec(`
        CREATE TABLE IF NOT EXISTS away_actions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          away_id INTEGER NOT NULL,
          workspace_id TEXT NOT NULL,
          subject TEXT NOT NULL,
          kind TEXT NOT NULL,
          key TEXT NOT NULL,
          detail TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          UNIQUE (away_id, key)
        )
      `);
    // When a task merged, whichever path merged it.
    const columns = db.prepare(`PRAGMA table_info(sessions)`).all() as {
      name: string;
    }[];
    if (!columns.some((c) => c.name === "merged_at"))
      db.exec(`ALTER TABLE sessions ADD COLUMN merged_at TEXT`);
    // When a task ended without a merge (dropped, or done with no PR or
    // its PR closed).
    if (!columns.some((c) => c.name === "task_ended_at"))
      db.exec(`ALTER TABLE sessions ADD COLUMN task_ended_at TEXT`);
    db.exec(`
        CREATE TRIGGER IF NOT EXISTS sessions_task_ended_at
          AFTER UPDATE OF task_status ON sessions
          WHEN NEW.task_status IN ('dropped', 'done')
            AND OLD.task_status IS NOT NEW.task_status
            AND NEW.task_ended_at IS OLD.task_ended_at
        BEGIN
          UPDATE sessions SET task_ended_at = datetime('now') WHERE id = NEW.id;
        END
      `);
    db.exec(`
        CREATE TRIGGER IF NOT EXISTS sessions_merged_at
          AFTER UPDATE OF task_status ON sessions
          WHEN NEW.task_status = 'merged' AND OLD.task_status IS NOT 'merged'
            -- unless the same statement set it (an import keeps its own)
            AND NEW.merged_at IS OLD.merged_at
        BEGIN
          UPDATE sessions SET merged_at = datetime('now') WHERE id = NEW.id;
        END
      `);
    installChangeTriggers(db, TABLES_WATCHED_58);
  },
} satisfies Migration;
