import type { Migration } from "../migration-types";

export default {
  id: 82,
  name: "session_shelf_times",
  up: (db) => {
    const cols = (
      db.prepare(`PRAGMA table_info(sessions)`).all() as { name: string }[]
    ).map((c) => c.name);
    // Last real activity, when it was marked done, and the snooze.
    for (const col of [
      "active_at",
      "settled_at",
      "snoozed_until",
      "snoozed_at",
    ])
      if (!cols.includes(col))
        db.exec(`ALTER TABLE sessions ADD COLUMN ${col} TEXT`);
    db.exec(
      `UPDATE sessions SET active_at = updated_at WHERE active_at IS NULL`
    );
  },
} satisfies Migration;
