import type { Migration } from "../migration-types";

export default {
  key: "20261102T0100_forks",
  up: (db) => {
    // The children ledger (lib/fork): one group per `aos fork` call, one row
    // per child. Tables of their own: columns on sessions would rebuild the
    // session_rows view. No FKs to sessions, like chat_views; a trigger below
    // drops a deleted session's rows.
    db.exec(`
      CREATE TABLE IF NOT EXISTS fork_groups (
        id TEXT PRIMARY KEY,
        parent_session_id TEXT NOT NULL,
        request_id TEXT NOT NULL UNIQUE,
        started_by TEXT NOT NULL CHECK (started_by IN ('agent', 'user')),
        context TEXT NOT NULL CHECK (context IN ('fork', 'brief')),
        delivery TEXT NOT NULL CHECK (delivery IN ('wake', 'next')),
        fork_item_id TEXT,
        created_at INTEGER NOT NULL,
        last_settled_at INTEGER
      )
    `);
    db.exec(`
      CREATE TABLE IF NOT EXISTS session_children (
        child_session_id TEXT PRIMARY KEY,
        parent_session_id TEXT NOT NULL,
        group_id TEXT NOT NULL REFERENCES fork_groups(id) ON DELETE CASCADE,
        position INTEGER NOT NULL,
        label TEXT NOT NULL,
        instruction TEXT NOT NULL,
        worktree INTEGER NOT NULL DEFAULT 0,
        state TEXT NOT NULL,
        hold TEXT,
        outcome TEXT,
        summary TEXT,
        result TEXT,
        result_kind TEXT,
        fell_back INTEGER NOT NULL DEFAULT 0,
        cut_message_id TEXT,
        idle_since INTEGER,
        started_at INTEGER,
        settled_at INTEGER,
        tokens_in INTEGER,
        tokens_out INTEGER,
        cache_read INTEGER,
        heavy_runs INTEGER NOT NULL DEFAULT 0,
        delivered_at INTEGER,
        delivery_id TEXT,
        used TEXT,
        created_at INTEGER NOT NULL
      )
    `);
    // A parent's `aos wait children`: delivered the moment it holds.
    db.exec(`
      CREATE TABLE IF NOT EXISTS fork_waits (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        parent_session_id TEXT NOT NULL,
        mode TEXT NOT NULL CHECK (mode IN ('all', 'any')),
        created_at INTEGER NOT NULL,
        deadline INTEGER NOT NULL,
        closed_at INTEGER
      )
    `);
    db.exec(
      `CREATE INDEX IF NOT EXISTS idx_fork_waits_open
         ON fork_waits(parent_session_id) WHERE closed_at IS NULL`
    );
    db.exec(
      `CREATE INDEX IF NOT EXISTS idx_children_parent
         ON session_children(parent_session_id, settled_at)`
    );
    db.exec(
      `CREATE INDEX IF NOT EXISTS idx_children_undelivered
         ON session_children(parent_session_id)
         WHERE settled_at IS NOT NULL AND delivered_at IS NULL`
    );
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS fork_children_session_deleted
      AFTER DELETE ON sessions
      BEGIN
        DELETE FROM session_children WHERE child_session_id = OLD.id;
        DELETE FROM fork_groups WHERE parent_session_id = OLD.id;
        DELETE FROM fork_waits WHERE parent_session_id = OLD.id;
      END
    `);
  },
} satisfies Migration;
