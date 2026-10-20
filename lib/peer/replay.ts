/**
 * Replay protection for peer envelopes: a timestamp within ±120 s, and each
 * peer's nonces remembered for as long as their timestamp would still pass.
 * A nonce is only ever forgotten once it's outside that window; a peer that
 * fills its cache inside the window is told it's busy rather than letting an
 * older nonce be replayed.
 *
 * The server's guard also writes each nonce to a NonceStore (SQLite,
 * nonce-store.ts) before the call runs, so a restart doesn't forget the
 * nonces still inside the window. Memory is only a cache in front of it; if
 * the store can't be written the call is refused as busy.
 */

import { SKEW_MS } from "./envelope";

export type Freshness = "ok" | "stale" | "replay" | "busy";

export interface NonceStore {
  /** Records the nonce until `until`; false if it's already recorded. */
  claim(peer: string, nonce: string, until: number, now: number): boolean;
  /** Forgets nonces whose time is up. */
  prune(now: number): void;
}

export interface ReplayGuard {
  check(peer: string, nonce: string, ts: number, now?: number): Freshness;
}

export function createReplayGuard(
  opts: { windowMs?: number; maxPerPeer?: number; store?: NonceStore } = {}
): ReplayGuard {
  const { store } = opts;
  const windowMs = opts.windowMs ?? SKEW_MS;
  const maxPerPeer = opts.maxPerPeer ?? 50_000;
  // nonce → the time after which its timestamp is stale anyway.
  const seen = new Map<string, Map<string, number>>();
  let sweptAt = 0;

  const sweep = (nonces: Map<string, number>, now: number) => {
    for (const [nonce, until] of nonces) if (until < now) nonces.delete(nonce);
  };

  return {
    check(peer, nonce, ts, now = Date.now()) {
      if (!Number.isFinite(ts) || Math.abs(now - ts) > windowMs) return "stale";
      if (now - sweptAt > windowMs) {
        sweptAt = now;
        for (const nonces of seen.values()) sweep(nonces, now);
        try {
          store?.prune(now);
        } catch {
          // pruned again next window
        }
      }
      let nonces = seen.get(peer);
      if (!nonces) seen.set(peer, (nonces = new Map()));
      const until = nonces.get(nonce);
      if (until !== undefined && until >= now) return "replay";
      if (nonces.size >= maxPerPeer) {
        sweep(nonces, now);
        if (nonces.size >= maxPerPeer) return "busy";
      }
      // Past ts + window the timestamp check refuses it on its own.
      const expires = ts + windowMs;
      if (store) {
        let fresh: boolean;
        try {
          fresh = store.claim(peer, nonce, expires, now);
        } catch {
          return "busy";
        }
        if (!fresh) {
          nonces.set(nonce, expires);
          return "replay";
        }
      }
      nonces.set(nonce, expires);
      return "ok";
    },
  };
}
