import type { Migration } from "../migration-types";

export default {
  id: 46,
  name: "session_port_slots",
  up: (db) => {
    // A session's port slot and the ports agentos.json's bases resolve to
    // with it (lib/ports.ts). The unique index is what keeps two parallel
    // starts, in any process, off one slot.
    const columns = db.prepare(`PRAGMA table_info(sessions)`).all() as {
      name: string;
    }[];
    if (!columns.some((c) => c.name === "port_slot"))
      db.exec(`ALTER TABLE sessions ADD COLUMN port_slot INTEGER`);
    if (!columns.some((c) => c.name === "ports"))
      db.exec(`ALTER TABLE sessions ADD COLUMN ports TEXT`);
    db.exec(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_port_slot ON sessions(port_slot) WHERE port_slot IS NOT NULL`
    );
  },
} satisfies Migration;
