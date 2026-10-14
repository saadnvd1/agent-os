import type { Migration } from "../migration-types";

export default {
  id: 38,
  name: "add_schedules",
  up: (db) => {
    // Cron schedules that start agent work, and every run they made or
    // skipped. A run's (schedule, slot) is unique: claiming the row is
    // what stops a slot from running twice. Runs are never deleted, and a
    // removed schedule is archived, not deleted, so its history stays.
    db.exec(`
        CREATE TABLE IF NOT EXISTS schedules (
          id TEXT PRIMARY KEY,
          workspace_id TEXT NOT NULL,
          project_id TEXT,
          name TEXT NOT NULL,
          cron TEXT NOT NULL,
          timezone TEXT NOT NULL DEFAULT 'America/Chicago',
          prompt TEXT NOT NULL,
          kind TEXT NOT NULL,
          enabled INTEGER NOT NULL DEFAULT 1,
          armed_at INTEGER NOT NULL,
          archived_at TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
      `);
    db.exec(`
        CREATE TABLE IF NOT EXISTS schedule_runs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          schedule_id TEXT NOT NULL,
          slot TEXT NOT NULL,
          slot_at INTEGER NOT NULL,
          trigger TEXT NOT NULL,
          outcome TEXT NOT NULL,
          detail TEXT,
          session_id TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          UNIQUE (schedule_id, slot)
        )
      `);
    db.exec(
      `CREATE INDEX IF NOT EXISTS idx_schedule_runs_schedule ON schedule_runs(schedule_id, id)`
    );
    // Which server process ticks the schedules: one row, renewed each
    // tick, so a second server on the same database never runs them.
    db.exec(`
        CREATE TABLE IF NOT EXISTS scheduler_lease (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          owner TEXT NOT NULL,
          pid INTEGER NOT NULL,
          heartbeat INTEGER NOT NULL
        )
      `);
  },
} satisfies Migration;
