import type { Migration } from "../migration-types";

export default {
  id: 87,
  name: "plan_pieces_reconcile",
  up: (db) => {
    // How many pieces a plan listed and what the checker folded, so a plan
    // that builds as fewer than it listed is never silent; the PRs agents
    // opened (from their `gh pr create` output) so one outside its task's
    // repo is noticed.
    const columns = db.prepare(`PRAGMA table_info(features)`).all() as {
      name: string;
    }[];
    if (!columns.some((c) => c.name === "listed"))
      db.exec(`ALTER TABLE features ADD COLUMN listed INTEGER`);
    if (!columns.some((c) => c.name === "folded"))
      db.exec(`ALTER TABLE features ADD COLUMN folded TEXT`);
    db.exec(`
        CREATE TABLE IF NOT EXISTS agent_prs (
          url TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          repo TEXT NOT NULL,
          number INTEGER NOT NULL,
          seen_at TEXT NOT NULL DEFAULT (datetime('now')),
          told_at TEXT
        );
      `);
  },
} satisfies Migration;
