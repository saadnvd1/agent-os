import type { Migration } from "../migration-types";

export default {
  key: "20261021T1800_health_reports",
  up: (db) => {
    // Plain-English health reports (lib/reports): one row per report, the
    // report itself as JSON, and the next-prompt draft of a task with no
    // analyst. Rows are kept for good.
    db.exec(`
      CREATE TABLE IF NOT EXISTS health_reports (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        workspace_id TEXT,
        head TEXT,
        trigger TEXT NOT NULL,
        evidence_hash TEXT NOT NULL,
        data TEXT NOT NULL,
        model TEXT,
        cost_usd REAL,
        draft_text TEXT,
        draft_status TEXT,
        draft_decided_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS health_reports_session
        ON health_reports(session_id, id);
      -- The operating mode (manual / assisted / autonomous) of a workspace
      -- (the default) or of one task (the override).
      CREATE TABLE IF NOT EXISTS operating_modes (
        scope TEXT NOT NULL,
        scope_id TEXT NOT NULL,
        mode TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (scope, scope_id)
      );
    `);
  },
} satisfies Migration;
