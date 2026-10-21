import type { Migration } from "../migration-types";
import { createSessionRowsView } from "../session-parts/view";

export default {
  key: "20261021T1400_session_agent_roles",
  up: (db) => {
    // The role a session was started in (developer, analyst, reviewer,
    // supervisor) and the crew it works with: the id of the session that
    // began it. Additive.
    const cols = (
      db.prepare(`PRAGMA table_info(sessions)`).all() as { name: string }[]
    ).map((c) => c.name);
    if (!cols.includes("agent_role"))
      db.exec(`ALTER TABLE sessions ADD COLUMN agent_role TEXT`);
    if (!cols.includes("crew_id"))
      db.exec(`ALTER TABLE sessions ADD COLUMN crew_id TEXT`);
    db.exec(`CREATE INDEX IF NOT EXISTS sessions_crew ON sessions(crew_id)`);
    createSessionRowsView(db);
  },
} satisfies Migration;
