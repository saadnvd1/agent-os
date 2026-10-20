import type { Migration } from "../migration-types";

export default {
  key: "20261020T1600_bus_waits",
  up: (db) => {
    // A session waiting on another (lib/bus/waits): for its reply, or for it
    // to go idle or merge. Closed rows stay as history.
    db.exec(`CREATE TABLE IF NOT EXISTS bus_waits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      waiter_id TEXT NOT NULL,
      target_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      message_id INTEGER,
      request TEXT,
      deadline INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      seen_busy_at INTEGER,
      nudged_at INTEGER,
      closed_at INTEGER,
      outcome TEXT,
      reply_id INTEGER
    )`);
    db.exec(
      `CREATE INDEX IF NOT EXISTS idx_bus_waits_open ON bus_waits(target_id) WHERE closed_at IS NULL`
    );
    db.exec(
      `CREATE INDEX IF NOT EXISTS idx_bus_waits_waiter ON bus_waits(waiter_id) WHERE closed_at IS NULL`
    );
    const cols = db.prepare(`PRAGMA table_info(bus_messages)`).all() as {
      name: string;
    }[];
    if (!cols.some((c) => c.name === "reply_to"))
      db.exec(`ALTER TABLE bus_messages ADD COLUMN reply_to INTEGER`);
  },
} satisfies Migration;
