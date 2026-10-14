import type { Migration } from "../migration-types";

export default {
  key: "20261014T1900_pause_note",
  up: (db) => {
    // Why a resume that was asked for hasn't happened yet (waiting for a
    // slot, held by load), shown on the task row. Additive.
    const has = (
      db.prepare(`PRAGMA table_info(sessions)`).all() as { name: string }[]
    ).some((c) => c.name === "pause_note");
    if (!has) db.exec(`ALTER TABLE sessions ADD COLUMN pause_note TEXT`);
  },
} satisfies Migration;
