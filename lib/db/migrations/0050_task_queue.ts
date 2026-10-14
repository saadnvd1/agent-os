import type { Migration } from "../migration-types";
import { installChangeTriggers, TABLES_WATCHED_50 } from "../changes";

export default {
  id: 50,
  name: "task_queue",
  up: (db) => {
    // Tasks waiting to start (lib/tasks/queue.ts): over the workspace's
    // limit on running tasks, or after another task. A row's id is the
    // session id it starts as, so a restart never starts one twice.
    db.exec(`
        CREATE TABLE IF NOT EXISTS task_queue (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL,
          prompt TEXT NOT NULL,
          name TEXT,
          model TEXT,
          view TEXT,
          base_branch TEXT,
          host_id TEXT,
          after_task TEXT,
          after_any TEXT,
          origin_workspace_id TEXT,
          position INTEGER NOT NULL,
          status TEXT NOT NULL DEFAULT 'queued',
          note TEXT,
          error TEXT,
          attempts INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          started_at TEXT
        )
      `);
    db.exec(
      `CREATE INDEX IF NOT EXISTS idx_task_queue_status ON task_queue(status, position)`
    );
    const columns = db.prepare(`PRAGMA table_info(workspaces)`).all() as {
      name: string;
    }[];
    // Null: no limit.
    if (!columns.some((c) => c.name === "max_running_tasks"))
      db.exec(`ALTER TABLE workspaces ADD COLUMN max_running_tasks INTEGER`);
    installChangeTriggers(db, TABLES_WATCHED_50);
  },
} satisfies Migration;
