import type { Migration } from "../migration-types";

export default {
  id: 16,
  name: "add_task_columns_to_sessions",
  up: (db) => {
    db.exec(`ALTER TABLE sessions ADD COLUMN task_prompt TEXT`);
    db.exec(`ALTER TABLE sessions ADD COLUMN task_status TEXT`);
    db.exec(
      `CREATE INDEX IF NOT EXISTS idx_sessions_task_status ON sessions(task_status)`
    );
  },
} satisfies Migration;
