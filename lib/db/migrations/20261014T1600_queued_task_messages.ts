import type { Migration } from "../migration-types";

export default {
  key: "20261014T1600_queued_task_messages",
  up: (db) => {
    // A message for a task still in the start queue, held (addressed to
    // the queue id, which is the session id it starts as) until its
    // first prompt. Additive.
    const has = (
      db.prepare(`PRAGMA table_info(bus_messages)`).all() as {
        name: string;
      }[]
    ).some((c) => c.name === "held_queued");
    if (!has)
      db.exec(`ALTER TABLE bus_messages ADD COLUMN held_queued INTEGER`);
    db.exec(
      `CREATE INDEX IF NOT EXISTS idx_bus_messages_held_queued
           ON bus_messages(to_id) WHERE held_queued = 1`
    );
  },
} satisfies Migration;
