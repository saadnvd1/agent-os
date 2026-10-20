import type { Migration } from "../migration-types";

export default {
  key: "20261020T1258_peer_links",
  up: (db) => {
    // A machine linked through Connect (lib/peer): its pinned keys, never a
    // token. Foreign keys aren't enforced here, so deleteHost removes the pin.
    db.exec(`CREATE TABLE IF NOT EXISTS peer_links (
      host_id TEXT PRIMARY KEY REFERENCES hosts(id) ON DELETE CASCADE,
      machine_id TEXT NOT NULL UNIQUE,
      hostname TEXT NOT NULL,
      sign_pub TEXT NOT NULL,
      box_pub TEXT NOT NULL,
      state TEXT NOT NULL DEFAULT 'active',
      suspended_reason TEXT,
      paired_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_ok_at TEXT,
      last_error TEXT
    )`);
    // Every peer call, both directions. Successful polling reads fold into
    // one row per route per hour (`bucket`, `count`).
    db.exec(`CREATE TABLE IF NOT EXISTS peer_audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      at INTEGER NOT NULL,
      host_id TEXT,
      machine_id TEXT,
      direction TEXT NOT NULL,
      method TEXT NOT NULL,
      route TEXT NOT NULL,
      status INTEGER NOT NULL,
      ms INTEGER NOT NULL DEFAULT 0,
      bytes INTEGER NOT NULL DEFAULT 0,
      outcome TEXT NOT NULL,
      bucket TEXT,
      count INTEGER NOT NULL DEFAULT 1
    )`);
    db.exec(
      `CREATE INDEX IF NOT EXISTS idx_peer_audit_host_at ON peer_audit(host_id, at)`
    );
    db.exec(
      `CREATE INDEX IF NOT EXISTS idx_peer_audit_bucket ON peer_audit(host_id, direction, route, bucket)`
    );
    const cols = db.prepare(`PRAGMA table_info(hosts)`).all() as {
      name: string;
    }[];
    if (!cols.some((c) => c.name === "kind"))
      db.exec(`ALTER TABLE hosts ADD COLUMN kind TEXT NOT NULL DEFAULT 'ssh'`);
  },
} satisfies Migration;
