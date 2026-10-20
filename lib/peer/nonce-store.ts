/**
 * The replay guard's nonces in SQLite, so they outlive a restart. One
 * statement both checks and records, so two requests carrying the same nonce
 * can't both pass.
 */

import { getDb } from "../db";
import type { NonceStore } from "./replay";

export function sqliteNonceStore(db = getDb): NonceStore {
  return {
    claim: (peer, nonce, until, now) =>
      db()
        .prepare(
          `INSERT INTO peer_nonces (machine_id, nonce, until) VALUES (?, ?, ?)
           ON CONFLICT (machine_id, nonce) DO UPDATE SET until = excluded.until
             WHERE peer_nonces.until < ?`
        )
        .run(peer.slice(0, 64), nonce, until, now).changes === 1,
    prune: (now) =>
      void db().prepare(`DELETE FROM peer_nonces WHERE until < ?`).run(now),
  };
}
