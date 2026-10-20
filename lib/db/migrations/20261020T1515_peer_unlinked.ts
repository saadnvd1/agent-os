import type { Migration } from "../migration-types";

export default {
  key: "20261020T1515_peer_unlinked",
  up: (db) => {
    // A machine unlinked here, from either side (lib/peer/unlink.ts): its pin
    // is gone, and its signing key is kept for 30 days so its next call can
    // be told, provably, that it's no longer linked, and so Machines can say
    // who unlinked it. Never trusted for anything else.
    db.exec(`CREATE TABLE IF NOT EXISTS peer_unlinked (
      machine_id TEXT PRIMARY KEY,
      host_id TEXT,
      sign_pub TEXT NOT NULL,
      by_peer INTEGER NOT NULL DEFAULT 0,
      reason TEXT NOT NULL,
      at INTEGER NOT NULL
    )`);
    db.exec(
      `CREATE INDEX IF NOT EXISTS idx_peer_unlinked_host ON peer_unlinked(host_id)`
    );
  },
} satisfies Migration;
