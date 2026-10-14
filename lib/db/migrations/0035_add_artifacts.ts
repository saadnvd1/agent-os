import type { Migration } from "../migration-types";

export default {
  id: 35,
  name: "add_artifacts",
  up: (db) => {
    // Pages a chat agent showed with html_render. The HTML lives in a file
    // under ~/.agent-os/artifacts; the row says whose it is and what it's
    // called.
    db.exec(`
        CREATE TABLE IF NOT EXISTS artifacts (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          title TEXT NOT NULL,
          path TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
      `);
    db.exec(
      `CREATE INDEX IF NOT EXISTS idx_artifacts_session ON artifacts(session_id, created_at)`
    );
  },
} satisfies Migration;
