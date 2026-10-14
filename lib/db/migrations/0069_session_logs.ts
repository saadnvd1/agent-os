import type { Migration } from "../migration-types";

export default {
  id: 69,
  name: "session_logs",
  up: (db) => {
    // One log per merged task, written by AgentOS from data it already
    // holds (lib/session-logs). Never deleted: the database is the record,
    // the markdown file on disk is a copy.
    db.exec(`
        CREATE TABLE IF NOT EXISTS session_logs (
          session_id TEXT PRIMARY KEY,
          project_id TEXT,
          workspace_id TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          markdown TEXT NOT NULL,
          data TEXT NOT NULL,
          file_path TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_session_logs_project
          ON session_logs(project_id, created_at);
        CREATE INDEX IF NOT EXISTS idx_session_logs_workspace
          ON session_logs(workspace_id, created_at);
      `);
  },
} satisfies Migration;
