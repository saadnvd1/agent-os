import type { Migration } from "../migration-types";
import {
  installChangeTriggers,
  TABLES_WATCHED_SESSION_GROUPS,
} from "../changes";
import { createSessionRowsView } from "../session-parts/view";

export default {
  key: "20261020T1800_session_groups",
  up: (db) => {
    // Named shelves a user files sessions into (lib/session-groups). Not the
    // old `groups` table, which nothing reads. Additive.
    db.exec(`CREATE TABLE IF NOT EXISTS session_groups (
      id TEXT PRIMARY KEY,
      workspace_id TEXT REFERENCES workspaces(id) ON DELETE SET NULL,
      name TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      collapsed INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      deleted_at TEXT
    )`);
    db.exec(
      `CREATE UNIQUE INDEX IF NOT EXISTS session_groups_name
         ON session_groups(COALESCE(workspace_id, ''), lower(name))
         WHERE deleted_at IS NULL`
    );
    const has = (
      db.prepare(`PRAGMA table_info(sessions)`).all() as { name: string }[]
    ).some((c) => c.name === "session_group_id");
    if (!has)
      db.exec(
        `ALTER TABLE sessions ADD COLUMN session_group_id TEXT
           REFERENCES session_groups(id) ON DELETE SET NULL`
      );
    db.exec(
      `CREATE INDEX IF NOT EXISTS sessions_session_group
         ON sessions(session_group_id)`
    );
    // A queued task remembers the group it starts in.
    const queueHas = (
      db.prepare(`PRAGMA table_info(task_queue)`).all() as { name: string }[]
    ).some((c) => c.name === "session_group_id");
    if (!queueHas)
      db.exec(`ALTER TABLE task_queue ADD COLUMN session_group_id TEXT`);
    createSessionRowsView(db);
    installChangeTriggers(db, TABLES_WATCHED_SESSION_GROUPS);
  },
} satisfies Migration;
