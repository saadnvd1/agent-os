import type { Migration } from "../migration-types";

export default {
  id: 3,
  name: "add_worktree_columns_to_sessions",
  up: (db) => {
    db.exec(`ALTER TABLE sessions ADD COLUMN worktree_path TEXT`);
    db.exec(`ALTER TABLE sessions ADD COLUMN branch_name TEXT`);
    db.exec(`ALTER TABLE sessions ADD COLUMN base_branch TEXT`);
    db.exec(`ALTER TABLE sessions ADD COLUMN dev_server_port INTEGER`);
  },
} satisfies Migration;
