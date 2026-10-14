import type { Migration } from "../migration-types";

export default {
  id: 86,
  name: "learning_cards",
  up: (db) => {
    // End-of-session suggestions (save as recipe, keep a lesson). An
    // accepted lesson row is the record of where it was applied.
    db.exec(`
        CREATE TABLE IF NOT EXISTS learning_cards (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          session_id TEXT NOT NULL,
          workspace_id TEXT,
          kind TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending',
          payload TEXT NOT NULL,
          destination TEXT,
          applied_ref TEXT,
          shown_at INTEGER,
          decided_at INTEGER,
          created_at INTEGER NOT NULL,
          UNIQUE (session_id, kind)
        );
        CREATE INDEX IF NOT EXISTS idx_learning_cards_dest
          ON learning_cards(destination, decided_at);
      `);
  },
} satisfies Migration;
