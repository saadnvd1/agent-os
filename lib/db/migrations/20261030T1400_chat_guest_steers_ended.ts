import type { Migration } from "../migration-types";

export default {
  key: "20261030T1400_chat_guest_steers_ended",
  up: (db) => {
    // When the steer's Drive ended: a worker that restarts after it has no
    // guest turn left to gate.
    const cols = db.prepare(`PRAGMA table_info(chat_guest_steers)`).all() as {
      name: string;
    }[];
    if (!cols.some((c) => c.name === "ended_at"))
      db.exec(`ALTER TABLE chat_guest_steers ADD COLUMN ended_at INTEGER`);
  },
} satisfies Migration;
