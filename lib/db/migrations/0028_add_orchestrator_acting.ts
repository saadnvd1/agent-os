import type { Migration } from "../migration-types";

export default {
  id: 28,
  name: "add_orchestrator_acting",
  up: (db) => {
    // The orchestrator's brakes (settings per workspace, and the brake in
    // force so it's noted once), its starts, its decision log, the reviews
    // and scope checks it ran per commit, and gate failures per task.
    db.exec(
      `ALTER TABLE workspaces ADD COLUMN orch_max_running INTEGER NOT NULL DEFAULT 4`
    );
    db.exec(
      `ALTER TABLE workspaces ADD COLUMN orch_max_starts_per_hour INTEGER NOT NULL DEFAULT 6`
    );
    db.exec(`ALTER TABLE workspaces ADD COLUMN orch_brake TEXT`);
    // The secret an orchestrator's worker sends with each tool call.
    db.exec(`ALTER TABLE sessions ADD COLUMN orch_token TEXT`);
    db.exec(`
        CREATE TABLE IF NOT EXISTS orchestrator_starts (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          workspace_id TEXT NOT NULL,
          kind TEXT NOT NULL,
          target TEXT,
          created_at TEXT NOT NULL
        )
      `);
    db.exec(
      `CREATE INDEX IF NOT EXISTS idx_orchestrator_starts
         ON orchestrator_starts(workspace_id, created_at)`
    );
    db.exec(`
        CREATE TABLE IF NOT EXISTS orchestrator_notes (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          workspace_id TEXT NOT NULL,
          kind TEXT NOT NULL DEFAULT 'note',
          text TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
      `);
    db.exec(
      `CREATE INDEX IF NOT EXISTS idx_orchestrator_notes
         ON orchestrator_notes(workspace_id, id)`
    );
    db.exec(`
        CREATE TABLE IF NOT EXISTS orchestrator_checks (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          workspace_id TEXT NOT NULL,
          session_id TEXT NOT NULL,
          sha TEXT NOT NULL,
          kind TEXT NOT NULL,
          status TEXT NOT NULL,
          detail TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          UNIQUE (session_id, sha, kind)
        )
      `);
    db.exec(`
        CREATE TABLE IF NOT EXISTS orchestrator_gate_failures (
          session_id TEXT NOT NULL,
          gate TEXT NOT NULL,
          workspace_id TEXT NOT NULL,
          count INTEGER NOT NULL DEFAULT 0,
          last_reason TEXT,
          escalated_at TEXT,
          PRIMARY KEY (session_id, gate)
        )
      `);
  },
} satisfies Migration;
