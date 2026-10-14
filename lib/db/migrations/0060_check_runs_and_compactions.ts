import type { Migration } from "../migration-types";

export default {
  id: 60,
  name: "check_runs_and_compactions",
  up: (db) => {
    // What each run of the independent reviewer and the scope check cost,
    // from its claude -p result: it leaves no transcript, so this is the
    // only record. And each compaction a chat's agent made, so tokens per
    // task can be compared before and after the threshold moved.
    db.exec(`
        CREATE TABLE IF NOT EXISTS check_runs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          workspace_id TEXT NOT NULL,
          session_id TEXT NOT NULL,
          label TEXT NOT NULL,
          pr_number INTEGER,
          sha TEXT NOT NULL,
          kind TEXT NOT NULL,
          model TEXT,
          input_tokens INTEGER NOT NULL,
          cache_write_tokens INTEGER NOT NULL,
          cache_read_tokens INTEGER NOT NULL,
          output_tokens INTEGER NOT NULL,
          cost_usd REAL NOT NULL,
          duration_ms INTEGER,
          at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_check_runs_at ON check_runs(at);
        CREATE INDEX IF NOT EXISTS idx_check_runs_sha ON check_runs(session_id, sha, kind);
        CREATE TABLE IF NOT EXISTS chat_compactions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          session_id TEXT NOT NULL,
          session_name TEXT NOT NULL,
          workspace_id TEXT,
          at INTEGER NOT NULL,
          trigger TEXT NOT NULL,
          before_tokens INTEGER,
          after_tokens INTEGER
        );
        CREATE INDEX IF NOT EXISTS idx_chat_compactions_at ON chat_compactions(at);
      `);
  },
} satisfies Migration;
