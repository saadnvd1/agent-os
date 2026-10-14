import type { Migration } from "../migration-types";

export default {
  id: 1,
  name: "add_group_path_to_sessions",
  up: (db) => {
    db.exec(
      `ALTER TABLE sessions ADD COLUMN group_path TEXT NOT NULL DEFAULT 'sessions'`
    );
  },
} satisfies Migration;
