import type { Migration } from "../migration-types";

export default {
  id: 5,
  name: "add_group_path_index",
  up: (db) => {
    db.exec(
      `CREATE INDEX IF NOT EXISTS idx_sessions_group ON sessions(group_path)`
    );
  },
} satisfies Migration;
