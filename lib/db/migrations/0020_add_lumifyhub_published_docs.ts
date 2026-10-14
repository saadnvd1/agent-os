import type { Migration } from "../migration-types";

export default {
  id: 20,
  name: "add_lumifyhub_published_docs",
  up: (db) => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS lumifyhub_published_docs (
          project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          repo_path TEXT NOT NULL,
          page_id TEXT NOT NULL,
          content_hash TEXT NOT NULL,
          published_at TEXT NOT NULL DEFAULT (datetime('now')),
          PRIMARY KEY (project_id, repo_path)
        )
      `);
  },
} satisfies Migration;
