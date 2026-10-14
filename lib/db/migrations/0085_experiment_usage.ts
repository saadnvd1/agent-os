import type { Migration } from "../migration-types";

export default {
  id: 85,
  name: "experiment_usage",
  up: (db) => {
    // What each experiment did: model calls with their cost, and the
    // non-model work (scripts run, suggestions shown and decided).
    db.exec(`
        CREATE TABLE IF NOT EXISTS experiment_usage (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          experiment_id TEXT NOT NULL,
          event TEXT NOT NULL,
          trigger TEXT NOT NULL,
          session_id TEXT,
          workspace_id TEXT,
          model TEXT,
          provider TEXT,
          input_tokens INTEGER NOT NULL DEFAULT 0,
          cache_write_tokens INTEGER NOT NULL DEFAULT 0,
          cache_read_tokens INTEGER NOT NULL DEFAULT 0,
          output_tokens INTEGER NOT NULL DEFAULT 0,
          cost_usd REAL NOT NULL DEFAULT 0,
          duration_ms INTEGER,
          ok INTEGER NOT NULL DEFAULT 1,
          detail TEXT,
          at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_experiment_usage_exp_at
          ON experiment_usage(experiment_id, at);
        CREATE INDEX IF NOT EXISTS idx_experiment_usage_session
          ON experiment_usage(session_id, experiment_id, event);
      `);
  },
} satisfies Migration;
