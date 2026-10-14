import type { Migration } from "../migration-types";

export default {
  id: 74,
  name: "held_task_replies",
  up: (db) => {
    // held_for / held_for_name: the orchestrator (id, name there) a held
    // task messages. relay_state: a held task's message to it, waiting for
    // the holder to pull it (pending) or pulled (relayed). relay_key: a
    // pulled message's key on the orchestrator's machine, so a repeat pull
    // is not delivered twice.
    const has = (table: string, col: string) =>
      (
        db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]
      ).some((c) => c.name === col);
    for (const col of ["held_for", "held_for_name"])
      if (!has("sessions", col))
        db.exec(`ALTER TABLE sessions ADD COLUMN ${col} TEXT`);
    for (const col of ["relay_state", "relay_key"])
      if (!has("bus_messages", col))
        db.exec(`ALTER TABLE bus_messages ADD COLUMN ${col} TEXT`);
    db.exec(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_bus_relay_key ON bus_messages(relay_key) WHERE relay_key IS NOT NULL;
         CREATE INDEX IF NOT EXISTS idx_bus_relay_pending ON bus_messages(relay_state) WHERE relay_state = 'pending'`
    );
  },
} satisfies Migration;
