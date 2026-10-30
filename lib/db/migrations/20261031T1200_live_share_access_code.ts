import type { Migration } from "../migration-types";

export default {
  key: "20261031T1200_live_share_access_code",
  up: (db) => {
    const cols = (
      db.prepare(`PRAGMA table_info(live_shares)`).all() as { name: string }[]
    ).map((c) => c.name);
    // Null is off. The code is kept in plain text so the host can see it again;
    // Connect holds only a keyed hash of it.
    if (!cols.includes("access_code"))
      db.exec(`ALTER TABLE live_shares ADD COLUMN access_code TEXT`);
  },
} satisfies Migration;
