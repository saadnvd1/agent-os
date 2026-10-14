import type { Migration } from "../migration-types";

export default {
  id: 41,
  name: "add_task_setup",
  up: (db) => {
    // How a task's worktree setup (deps, setup commands) went before its
    // agent started: running, ok or failed, how long, and what failed;
    // and the brief its launch needs, so a restart can resume it.
    db.transaction(() => {
      db.exec(`ALTER TABLE sessions ADD COLUMN setup_status TEXT`);
      db.exec(`ALTER TABLE sessions ADD COLUMN setup_ms INTEGER`);
      db.exec(`ALTER TABLE sessions ADD COLUMN setup_error TEXT`);
      db.exec(`ALTER TABLE sessions ADD COLUMN task_brief TEXT`);
    })();
  },
} satisfies Migration;
