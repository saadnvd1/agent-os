import type { Migration } from "../migration-types";

export default {
  id: 10,
  name: "add_project_id_to_dev_servers",
  up: (db) => {
    // Check if column exists first
    const cols = db.prepare(`PRAGMA table_info(dev_servers)`).all() as {
      name: string;
    }[];
    if (cols.some((c) => c.name === "project_id")) return;

    db.exec(
      `ALTER TABLE dev_servers ADD COLUMN project_id TEXT REFERENCES projects(id)`
    );
    // Migrate from session_id if it exists
    const hasSessionId = cols.some((c) => c.name === "session_id");
    if (hasSessionId) {
      db.exec(`
          UPDATE dev_servers
          SET project_id = (
            SELECT COALESCE(s.project_id, 'uncategorized')
            FROM sessions s
            WHERE s.id = dev_servers.session_id
          )
          WHERE project_id IS NULL
        `);
    }
    db.exec(
      `UPDATE dev_servers SET project_id = 'uncategorized' WHERE project_id IS NULL`
    );
    db.exec(
      `CREATE INDEX IF NOT EXISTS idx_dev_servers_project ON dev_servers(project_id)`
    );
  },
} satisfies Migration;
