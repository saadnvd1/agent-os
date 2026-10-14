import type { Migration } from "../migration-types";

export default {
  id: 48,
  name: "session_database",
  up: (db) => {
    // The session's private Postgres copy, or why it has none, as JSON
    // (lib/project-config/database.ts).
    const columns = db.prepare(`PRAGMA table_info(sessions)`).all() as {
      name: string;
    }[];
    if (!columns.some((c) => c.name === "database"))
      db.exec(`ALTER TABLE sessions ADD COLUMN database TEXT`);
  },
} satisfies Migration;
