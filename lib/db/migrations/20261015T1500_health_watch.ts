import type { Migration } from "../migration-types";

export default {
  key: "20261015T1500_health_watch",
  up: (db) => {
    // The health watcher (lib/health): anomalies its detectors open and
    // the verdicts the watchers give, server boots, CI runs and the
    // watchers' notes on what normal looks like. Additive; rows are kept.
    db.exec(`
      CREATE TABLE IF NOT EXISTS health_anomalies (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        check_id TEXT NOT NULL,
        subject TEXT NOT NULL,
        area TEXT NOT NULL,
        severity TEXT NOT NULL,
        line TEXT NOT NULL,
        detail TEXT NOT NULL DEFAULT '{}',
        workspace_id TEXT,
        opened_at INTEGER NOT NULL,
        last_seen_at INTEGER NOT NULL,
        closed_at INTEGER,
        close_reason TEXT,
        muted_until INTEGER,
        hits INTEGER NOT NULL DEFAULT 1,
        woken_severity TEXT,
        woken_at INTEGER,
        verdict TEXT,
        tokens_in INTEGER,
        tokens_out INTEGER,
        delivered_at INTEGER,
        phoned_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_health_anomalies_subject
        ON health_anomalies(check_id, subject, closed_at);
      CREATE INDEX IF NOT EXISTS idx_health_anomalies_opened
        ON health_anomalies(opened_at);

      CREATE TABLE IF NOT EXISTS health_boots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        started_at INTEGER NOT NULL,
        pid INTEGER NOT NULL,
        head TEXT,
        prev_seen_at INTEGER,
        prev_bg TEXT
      );

      CREATE TABLE IF NOT EXISTS ci_runs (
        project_id TEXT NOT NULL,
        workspace_id TEXT,
        pr_number INTEGER NOT NULL,
        head TEXT NOT NULL,
        pending_since INTEGER NOT NULL,
        settled_at INTEGER,
        PRIMARY KEY (project_id, pr_number, head)
      );

      CREATE TABLE IF NOT EXISTS watcher_notes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        area TEXT NOT NULL,
        line TEXT NOT NULL,
        source TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_watcher_notes_area
        ON watcher_notes(area, id);
    `);
  },
} satisfies Migration;
