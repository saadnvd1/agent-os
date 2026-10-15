import type { Migration } from "../migration-types";
import {
  installChangeTriggers,
  TABLES_WATCHED_LEARNING_CARDS,
} from "../changes";

export default {
  key: "20261014T2300_learning_cards_watch",
  up: (db) => {
    // A card decided in one place disappears from every open screen.
    // Additive: an index and change triggers.
    db.exec(
      `CREATE INDEX IF NOT EXISTS idx_learning_cards_pending
         ON learning_cards(status, created_at)`
    );
    installChangeTriggers(db, TABLES_WATCHED_LEARNING_CARDS);
  },
} satisfies Migration;
