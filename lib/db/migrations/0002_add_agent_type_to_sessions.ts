import type { Migration } from "../migration-types";

export default {
  id: 2,
  name: "add_agent_type_to_sessions",
  up: (db) => {
    db.exec(
      `ALTER TABLE sessions ADD COLUMN agent_type TEXT NOT NULL DEFAULT 'claude'`
    );
  },
} satisfies Migration;
