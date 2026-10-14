import type { Migration } from "../migration-types";

export default {
  id: 13,
  name: "add_project_repositories_table",
  up: (db) => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS project_repositories (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL,
          name TEXT NOT NULL,
          path TEXT NOT NULL,
          is_primary INTEGER NOT NULL DEFAULT 0,
          sort_order INTEGER NOT NULL DEFAULT 0,
          FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
        )
      `);
    db.exec(
      `CREATE INDEX IF NOT EXISTS idx_project_repositories_project ON project_repositories(project_id)`
    );
  },
} satisfies Migration;
