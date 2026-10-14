import type { Migration } from "../migration-types";

export default {
  id: 4,
  name: "add_pr_tracking_to_sessions",
  up: (db) => {
    db.exec(`ALTER TABLE sessions ADD COLUMN pr_url TEXT`);
    db.exec(`ALTER TABLE sessions ADD COLUMN pr_number INTEGER`);
    db.exec(`ALTER TABLE sessions ADD COLUMN pr_status TEXT`);
  },
} satisfies Migration;
