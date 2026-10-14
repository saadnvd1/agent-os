import type { Migration } from "../migration-types";

export default {
  id: 42,
  name: "add_host_links_and_moved_tasks",
  up: (db) => {
    // How this machine reaches another machine's own AgentOS: its URL and
    // the device token it paired with. Apart from hosts so the token never
    // rides along with a host row to the browser.
    db.transaction(() => {
      db.exec(`
          CREATE TABLE IF NOT EXISTS host_links (
            host_id TEXT PRIMARY KEY REFERENCES hosts(id) ON DELETE CASCADE,
            url TEXT NOT NULL,
            token TEXT NOT NULL,
            linked_at TEXT NOT NULL DEFAULT (datetime('now'))
          )
        `);
      // A task moved to another machine keeps its row, marked where it
      // went; one that arrived names the session it came from, so the
      // same move imported twice finds the first.
      db.exec(`ALTER TABLE sessions ADD COLUMN moved_to TEXT`);
      db.exec(`ALTER TABLE sessions ADD COLUMN moved_from TEXT`);
      db.exec(
        `CREATE INDEX IF NOT EXISTS idx_sessions_moved_from ON sessions(moved_from)`
      );
    })();
  },
} satisfies Migration;
