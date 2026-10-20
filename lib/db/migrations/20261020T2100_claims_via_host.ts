import type { Migration } from "../migration-types";

export default {
  key: "20261020T2100_claims_via_host",
  up: (db) => {
    // The link (hosts.id) a remote claim arrived through, and which claims
    // machine each link talks to, so a machine linked twice is asked once.
    const cols = db.prepare(`PRAGMA table_info(work_claims)`).all() as {
      name: string;
    }[];
    if (!cols.some((c) => c.name === "via_host"))
      db.exec(`ALTER TABLE work_claims ADD COLUMN via_host TEXT`);
    db.exec(`
      CREATE TABLE IF NOT EXISTS claim_peers (
        host_id TEXT PRIMARY KEY,
        machine_id TEXT NOT NULL,
        seen_at INTEGER NOT NULL
      );
    `);
  },
} satisfies Migration;
