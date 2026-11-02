import type { Migration } from "../migration-types";

export default {
  key: "20261102T2330_lead_direction_unpin_and_adoptions",
  up: (db) => {
    // A pin the person takes down without a newer one in its place. The row
    // stays, so the history still shows it.
    const cols = db.prepare(`PRAGMA table_info(lead_direction)`).all() as {
      name: string;
    }[];
    if (!cols.some((c) => c.name === "retired_at"))
      db.exec(`ALTER TABLE lead_direction ADD COLUMN retired_at TEXT`);
    // An adopted lead keeps its old conversation until the person confirms
    // its proposed pins; switched_at is that tap.
    db.exec(`
      CREATE TABLE IF NOT EXISTS lead_adoptions (
        session_id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        lead_kind TEXT NOT NULL,
        adopted_at TEXT NOT NULL DEFAULT (datetime('now')),
        switched_at TEXT
      )
    `);
  },
} satisfies Migration;
