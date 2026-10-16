import type { Migration } from "../migration-types";

export default {
  key: "20261016T1800_env_failures",
  up: (db) => {
    // One row per session and class of environment failure (wrong Python,
    // a refused write, a lost permission), with whether its fix was sent and
    // whether it reached the orchestrator. Additive.
    db.exec(`
      CREATE TABLE IF NOT EXISTS env_failures (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        class TEXT NOT NULL,
        project_id TEXT,
        workspace_id TEXT,
        command TEXT,
        line TEXT,
        last_item_id TEXT,
        hits INTEGER NOT NULL DEFAULT 1,
        first_at INTEGER NOT NULL,
        last_at INTEGER NOT NULL,
        nudged_at INTEGER,
        nudge_skipped TEXT,
        alerted TEXT,
        alerted_at INTEGER,
        UNIQUE(session_id, class)
      );
      CREATE INDEX IF NOT EXISTS idx_env_failures_class_first
        ON env_failures(class, first_at);
      CREATE INDEX IF NOT EXISTS idx_env_failures_last ON env_failures(last_at);
    `);
  },
} satisfies Migration;
