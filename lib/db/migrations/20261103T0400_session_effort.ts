import type { Migration } from "../migration-types";
import { createSessionRowsView } from "../session-parts/view";

const addColumn = (
  db: Parameters<Migration["up"]>[0],
  table: string,
  column: string
) => {
  const cols = (
    db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]
  ).map((c) => c.name);
  if (!cols.includes(column))
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} TEXT`);
};

export default {
  key: "20261103T0400_session_effort",
  up: (db) => {
    // The reasoning effort a session started at (null: the agent's default).
    // A queued task keeps it until it starts.
    addColumn(db, "sessions", "effort");
    addColumn(db, "task_queue", "effort");
    createSessionRowsView(db);
  },
} satisfies Migration;
