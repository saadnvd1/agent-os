import type { Migration } from "../migration-types";

export default {
  key: "20261030T1200_live_share_level",
  up: (db) => {
    const cols = (
      db.prepare(`PRAGMA table_info(live_shares)`).all() as { name: string }[]
    ).map((c) => c.name);
    // Existing links keep what they always did: suggest, with the whole chat.
    if (!cols.includes("level"))
      db.exec(
        `ALTER TABLE live_shares ADD COLUMN level TEXT NOT NULL DEFAULT 'suggest'`
      );
    if (!cols.includes("history"))
      db.exec(
        `ALTER TABLE live_shares ADD COLUMN history INTEGER NOT NULL DEFAULT 1`
      );
  },
} satisfies Migration;
