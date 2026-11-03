import type { Migration } from "../migration-types";
import { createSessionRowsView } from "../session-parts/view";

export default {
  key: "20261103T0300_session_finished_at",
  up: (db) => {
    // When done ended a session's agent. A task says so in task_status; a
    // session with no task needs its own mark to leave the peer list.
    const cols = (
      db.prepare(`PRAGMA table_info(sessions)`).all() as { name: string }[]
    ).map((c) => c.name);
    if (!cols.includes("finished_at"))
      db.exec(`ALTER TABLE sessions ADD COLUMN finished_at TEXT`);
    createSessionRowsView(db);
  },
} satisfies Migration;
