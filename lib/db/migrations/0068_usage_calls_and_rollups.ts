import type { Migration } from "../migration-types";

export default {
  id: 68,
  name: "usage_calls_and_rollups",
  up: (db) => {
    // One row per Claude response (or per one-shot run), the daily rollups
    // computed from them, the ratchet's baseline and the limit readings.
    db.transaction(() => {
      db.exec(`
          CREATE TABLE IF NOT EXISTS usage_calls (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            call_key TEXT NOT NULL UNIQUE,
            at INTEGER NOT NULL,
            session_id TEXT,
            task_id TEXT,
            workspace_id TEXT,
            project_id TEXT,
            session_name TEXT,
            role TEXT,
            kind TEXT NOT NULL,
            agent_type TEXT,
            model TEXT,
            provider TEXT,
            input_tokens INTEGER NOT NULL DEFAULT 0,
            cache_read_tokens INTEGER NOT NULL DEFAULT 0,
            cache_write_5m_tokens INTEGER NOT NULL DEFAULT 0,
            cache_write_1h_tokens INTEGER NOT NULL DEFAULT 0,
            output_tokens INTEGER NOT NULL DEFAULT 0,
            ctx_tokens INTEGER,
            source TEXT NOT NULL
          );
          CREATE INDEX IF NOT EXISTS idx_usage_calls_at ON usage_calls(at);
          CREATE INDEX IF NOT EXISTS idx_usage_calls_task ON usage_calls(task_id);
          CREATE INDEX IF NOT EXISTS idx_usage_calls_session ON usage_calls(session_id);
          CREATE TABLE IF NOT EXISTS rate_limit_readings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            at INTEGER NOT NULL,
            window TEXT NOT NULL,
            utilization REAL NOT NULL,
            raw REAL,
            resets_at INTEGER,
            status TEXT,
            session_id TEXT,
            source TEXT NOT NULL
          );
          CREATE INDEX IF NOT EXISTS idx_rate_limit_readings ON rate_limit_readings(window, at);
          CREATE TABLE IF NOT EXISTS usage_rollups (
            day TEXT PRIMARY KEY,
            data TEXT NOT NULL,
            final INTEGER NOT NULL DEFAULT 0,
            computed_at INTEGER NOT NULL
          );
          CREATE TABLE IF NOT EXISTS usage_baseline (
            metric TEXT PRIMARY KEY,
            value REAL NOT NULL,
            set_at INTEGER NOT NULL,
            supporting TEXT
          );
          CREATE TABLE IF NOT EXISTS usage_alerts (
            kind TEXT PRIMARY KEY,
            opened_at INTEGER NOT NULL,
            cleared_at INTEGER,
            message TEXT NOT NULL
          );
          CREATE TABLE IF NOT EXISTS usage_import_offsets (
            path TEXT PRIMARY KEY,
            offset INTEGER NOT NULL,
            mtime INTEGER NOT NULL
          );
        `);
    })();
  },
} satisfies Migration;
