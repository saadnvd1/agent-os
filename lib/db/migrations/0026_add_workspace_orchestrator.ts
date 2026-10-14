import type { Migration } from "../migration-types";

export default {
  id: 26,
  name: "add_workspace_orchestrator",
  up: (db) => {
    // One standing orchestrator chat per workspace. Its events are kept
    // by key: a key present means that event is known, delivered or
    // queued. An event is sent once seen on two diffs in a row (hits);
    // a passing one that cleared is remembered (cleared_at) so it can't
    // fire again too soon. The log counts deliveries per subject.
    db.exec(`ALTER TABLE sessions ADD COLUMN role TEXT`);
    db.exec(`ALTER TABLE sessions ADD COLUMN workspace_id TEXT`);
    db.exec(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_orchestrator
         ON sessions(workspace_id) WHERE role = 'orchestrator'`
    );
    db.exec(`
        CREATE TABLE IF NOT EXISTS orchestrator_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          workspace_id TEXT NOT NULL,
          key TEXT NOT NULL,
          subject TEXT,
          line TEXT NOT NULL,
          sticky INTEGER NOT NULL DEFAULT 1,
          low INTEGER NOT NULL DEFAULT 0,
          hits INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL,
          delivered_at TEXT,
          cleared_at TEXT,
          UNIQUE (workspace_id, key)
        )
      `);
    db.exec(`
        CREATE TABLE IF NOT EXISTS orchestrator_event_log (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          workspace_id TEXT NOT NULL,
          subject TEXT,
          delivered_at TEXT NOT NULL
        )
      `);
    db.exec(
      `CREATE INDEX IF NOT EXISTS idx_orchestrator_event_log
         ON orchestrator_event_log(workspace_id, delivered_at)`
    );
  },
} satisfies Migration;
