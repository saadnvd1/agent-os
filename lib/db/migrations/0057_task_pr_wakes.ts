import type { Migration } from "../migration-types";

export default {
  id: 57,
  name: "task_pr_wakes",
  up: (db) => {
    // What a task's agent was told about its PR (orchestrator/pr-wake.ts),
    // one row per failing head or review/comment id, claimed before the
    // message goes. kind: check, review or comment (comments are capped).
    db.exec(`
        CREATE TABLE IF NOT EXISTS task_pr_wakes (
          session_id TEXT NOT NULL,
          key TEXT NOT NULL,
          kind TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          PRIMARY KEY (session_id, key)
        );
      `);
    // pr_wake_since: reviews and comments older than this are taken as
    // known when a task's PR is first watched.
    const sessions = db.prepare(`PRAGMA table_info(sessions)`).all() as {
      name: string;
    }[];
    if (!sessions.some((c) => c.name === "pr_wake_since"))
      db.exec(`ALTER TABLE sessions ADD COLUMN pr_wake_since TEXT`);
    const workspaces = db.prepare(`PRAGMA table_info(workspaces)`).all() as {
      name: string;
    }[];
    if (!workspaces.some((c) => c.name === "wake_tasks_on_pr"))
      db.exec(
        `ALTER TABLE workspaces ADD COLUMN wake_tasks_on_pr INTEGER NOT NULL DEFAULT 1`
      );
  },
} satisfies Migration;
