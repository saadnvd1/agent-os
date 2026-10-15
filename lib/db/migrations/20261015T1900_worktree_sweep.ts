import type { Migration } from "../migration-types";

export default {
  key: "20261015T1900_worktree_sweep",
  up: (db) => {
    // One row per clean-up run, kept for good, with what it removed and
    // skipped as JSON; and which sessions' worktrees a run removed, so a
    // restore can say so. Additive.
    db.exec(`
      CREATE TABLE IF NOT EXISTS worktree_sweep_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        started_at TEXT NOT NULL DEFAULT (datetime('now')),
        finished_at TEXT,
        dry_run INTEGER NOT NULL DEFAULT 0,
        removed INTEGER NOT NULL DEFAULT 0,
        freed_bytes INTEGER NOT NULL DEFAULT 0,
        skipped INTEGER NOT NULL DEFAULT 0,
        details TEXT,
        error TEXT
      );
      CREATE TABLE IF NOT EXISTS session_worktree_sweeps (
        session_id TEXT PRIMARY KEY,
        path TEXT NOT NULL,
        branch TEXT,
        swept_at TEXT NOT NULL DEFAULT (datetime('now')),
        run_id INTEGER
      );
    `);
  },
} satisfies Migration;
