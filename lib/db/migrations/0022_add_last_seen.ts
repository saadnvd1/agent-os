import type { Migration } from "../migration-types";

export default {
  id: 22,
  name: "add_last_seen",
  up: (db) => {
    // When the reader last looked, so "needs you" means something new.
    db.exec(`ALTER TABLE sessions ADD COLUMN last_seen_at TEXT`);
  },
} satisfies Migration;
