import type { Migration } from "../migration-types";

export default {
  id: 7,
  name: "add_auto_approve_to_sessions",
  up: (db) => {
    db.exec(
      `ALTER TABLE sessions ADD COLUMN auto_approve INTEGER NOT NULL DEFAULT 0`
    );
  },
} satisfies Migration;
