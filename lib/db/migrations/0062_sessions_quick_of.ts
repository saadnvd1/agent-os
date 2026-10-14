import type { Migration } from "../migration-types";

export default {
  id: 62,
  name: "sessions_quick_of",
  up: (db) => {
    // A quick change (orchestrator/quick.ts): a task row with no agent,
    // whose worktree the orchestrator with this session id edits itself.
    // Set only by quick_change; the code-review gate reads it.
    const columns = db.prepare(`PRAGMA table_info(sessions)`).all() as {
      name: string;
    }[];
    if (!columns.some((c) => c.name === "quick_of"))
      db.exec(`ALTER TABLE sessions ADD COLUMN quick_of TEXT`);
    db.exec(
      `CREATE INDEX IF NOT EXISTS idx_sessions_quick_of ON sessions(quick_of) WHERE quick_of IS NOT NULL`
    );
  },
} satisfies Migration;
