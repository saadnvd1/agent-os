import type { Migration } from "../migration-types";

export default {
  id: 9,
  name: "add_project_id_to_sessions",
  up: (db) => {
    db.exec(
      `ALTER TABLE sessions ADD COLUMN project_id TEXT REFERENCES projects(id)`
    );
    db.exec(
      `UPDATE sessions SET project_id = 'uncategorized' WHERE project_id IS NULL`
    );
    db.exec(
      `CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_id)`
    );
  },
} satisfies Migration;
