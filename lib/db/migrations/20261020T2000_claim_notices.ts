import type { Migration } from "../migration-types";

export default {
  key: "20261020T2000_claim_notices",
  up: (db) => {
    // What a mid-work overlap between two claims has told the local session:
    // how many syncs it has held, the shared paths last told, and whether the
    // winner's merge has been passed on. Times are this machine's clock in ms.
    db.exec(`
      CREATE TABLE IF NOT EXISTS claim_notices (
        pair_key TEXT PRIMARY KEY,
        hits INTEGER NOT NULL DEFAULT 0,
        shared TEXT NOT NULL DEFAULT '[]',
        told_at INTEGER,
        merged_at INTEGER,
        seen_at INTEGER NOT NULL
      );
    `);
  },
} satisfies Migration;
