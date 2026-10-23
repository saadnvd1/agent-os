import type { Migration } from "../migration-types";

export default {
  key: "20261023T1200_host_info",
  up: (db) => {
    // What a linked machine says about itself (GET /api/machine), kept so its
    // name, OS and addresses show while it is offline. Foreign keys aren't
    // enforced here, so deleteHost removes the row.
    db.exec(`CREATE TABLE IF NOT EXISTS host_info (
      host_id TEXT PRIMARY KEY REFERENCES hosts(id) ON DELETE CASCADE,
      name TEXT,
      hostname TEXT,
      os TEXT,
      arch TEXT,
      connect_machine_id TEXT,
      addresses TEXT NOT NULL DEFAULT '[]',
      fetched_at INTEGER NOT NULL DEFAULT 0
    )`);
  },
} satisfies Migration;
