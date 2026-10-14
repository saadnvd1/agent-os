import type { Migration } from "../migration-types";

export default {
  id: 39,
  name: "add_session_name_source",
  up: (db) => {
    // Who named a session: "user" (typed or given explicitly, never
    // renamed for them), "generated" (a title picked from its prompt) or
    // "default" ("Session 4", or a placeholder until a title arrives).
    // One transaction, so a crash part-way leaves nothing to skip.
    db.transaction(() => {
      db.exec(
        `ALTER TABLE sessions ADD COLUMN name_source TEXT NOT NULL DEFAULT 'default'`
      );
      // A session renamed by hand before this keeps its name.
      db.exec(
        `UPDATE sessions SET name_source = 'user' WHERE id IN (SELECT session_id FROM session_names)`
      );
    })();
  },
} satisfies Migration;
