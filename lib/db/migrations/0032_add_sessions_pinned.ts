import type { Migration } from "../migration-types";

export default {
  id: 32,
  name: "add_sessions_pinned",
  up: (db) => {
    // Pinned sessions sit on their own shelf at the top of the sidebar.
    db.exec(
      `ALTER TABLE sessions ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0`
    );
  },
} satisfies Migration;
