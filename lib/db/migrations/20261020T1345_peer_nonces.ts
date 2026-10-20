import type { Migration } from "../migration-types";

export default {
  key: "20261020T1345_peer_nonces",
  up: (db) => {
    // Nonces of linked machines' envelopes (lib/peer/replay.ts), kept until
    // their timestamp would be stale anyway, so a restart can't replay one.
    db.exec(`CREATE TABLE IF NOT EXISTS peer_nonces (
      machine_id TEXT NOT NULL,
      nonce TEXT NOT NULL,
      until INTEGER NOT NULL,
      PRIMARY KEY (machine_id, nonce)
    )`);
    db.exec(
      `CREATE INDEX IF NOT EXISTS idx_peer_nonces_until ON peer_nonces(until)`
    );
  },
} satisfies Migration;
