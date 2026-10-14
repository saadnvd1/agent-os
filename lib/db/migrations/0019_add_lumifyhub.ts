import type { Migration } from "../migration-types";

export default {
  id: 19,
  name: "add_lumifyhub",
  up: (db) => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS lumifyhub_connection (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          base_url TEXT NOT NULL,
          token TEXT NOT NULL,
          user_id TEXT,
          user_email TEXT,
          user_name TEXT,
          connected_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
      `);
    db.exec(`
        CREATE TABLE IF NOT EXISTS lumifyhub_connect_attempts (
          state TEXT PRIMARY KEY,
          verifier TEXT NOT NULL,
          redirect_uri TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
      `);
    db.exec(`ALTER TABLE workspaces ADD COLUMN lh_workspace_id TEXT`);
    db.exec(`ALTER TABLE workspaces ADD COLUMN lh_workspace_slug TEXT`);
    db.exec(`ALTER TABLE workspaces ADD COLUMN lh_workspace_name TEXT`);
    db.exec(`ALTER TABLE projects ADD COLUMN lh_board_id TEXT`);
    db.exec(`ALTER TABLE projects ADD COLUMN lh_board_name TEXT`);
    db.exec(`ALTER TABLE projects ADD COLUMN lh_board_page_id TEXT`);
    db.exec(`ALTER TABLE sessions ADD COLUMN lh_card_id TEXT`);
    db.exec(`ALTER TABLE sessions ADD COLUMN lh_board_id TEXT`);
    db.exec(`ALTER TABLE sessions ADD COLUMN lh_card_list TEXT`);
  },
} satisfies Migration;
