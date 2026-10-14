import type { Migration } from "../migration-types";

export default {
  id: 24,
  name: "add_stacks",
  up: (db) => {
    // A LumifyHub board's cards run as stacked tasks (lib/stacks).
    db.exec(`
        CREATE TABLE IF NOT EXISTS stacks (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          lh_board_id TEXT NOT NULL,
          name TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'running',
          max_parallel INTEGER NOT NULL DEFAULT 3,
          progress TEXT,
          error TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          landed_at TEXT
        )
      `);
    db.exec(`
        CREATE TABLE IF NOT EXISTS stack_items (
          id TEXT PRIMARY KEY,
          stack_id TEXT NOT NULL REFERENCES stacks(id) ON DELETE CASCADE,
          position INTEGER NOT NULL,
          lh_card_id TEXT NOT NULL,
          ticket TEXT,
          title TEXT NOT NULL,
          parent_item_id TEXT,
          also_item_ids TEXT NOT NULL DEFAULT '[]',
          blocker_item_ids TEXT NOT NULL DEFAULT '[]',
          status TEXT NOT NULL DEFAULT 'planned',
          session_id TEXT,
          base_branch TEXT,
          base_tip TEXT,
          pr_number INTEGER,
          note TEXT,
          error TEXT
        )
      `);
    db.exec(
      `CREATE INDEX IF NOT EXISTS idx_stack_items_stack ON stack_items(stack_id, position)`
    );
    db.exec(
      `CREATE INDEX IF NOT EXISTS idx_stack_items_session ON stack_items(session_id)`
    );
  },
} satisfies Migration;
