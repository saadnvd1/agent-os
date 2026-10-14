import type { Migration } from "../migration-types";

export default {
  id: 53,
  name: "brief_amendments_failure_sha_ask_raised_by",
  up: (db) => {
    // Scope changes the orchestrator records on a task after it started
    // (send with scope_change); its review judges against them.
    db.exec(`
        CREATE TABLE IF NOT EXISTS brief_amendments (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          session_id TEXT NOT NULL,
          workspace_id TEXT NOT NULL,
          text TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_brief_amendments_session
          ON brief_amendments(session_id);
      `);
    // The commit a stored verdict's failure was counted for, so reading
    // the same verdict again isn't a second failure.
    const columns = db
      .prepare(`PRAGMA table_info(orchestrator_gate_failures)`)
      .all() as { name: string }[];
    if (!columns.some((c) => c.name === "last_sha"))
      db.exec(
        `ALTER TABLE orchestrator_gate_failures ADD COLUMN last_sha TEXT`
      );
    // Who raised a merge ask: the orchestrator may refresh its own, never
    // one the gates raised.
    const asks = db.prepare(`PRAGMA table_info(orchestrator_asks)`).all() as {
      name: string;
    }[];
    if (!asks.some((c) => c.name === "raised_by"))
      db.exec(`ALTER TABLE orchestrator_asks ADD COLUMN raised_by TEXT`);
  },
} satisfies Migration;
