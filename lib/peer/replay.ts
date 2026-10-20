/**
 * Replay protection for peer envelopes: a timestamp within ±120 s, and each
 * peer's nonces remembered for as long as their timestamp would still pass.
 * A nonce is only ever forgotten once it's outside that window; a peer that
 * fills its cache inside the window is told it's busy rather than letting an
 * older nonce be replayed.
 *
 * The cache lives in memory, so anything stamped before this guard was made
 * (before the server started) is stale: otherwise a restart would forget the
 * nonces of envelopes still inside the window, and one could run twice, its
 * answer sealed again under the same one-time key.
 */

import { SKEW_MS } from "./envelope";

export type Freshness = "ok" | "stale" | "replay" | "busy";

export interface ReplayGuard {
  check(peer: string, nonce: string, ts: number, now?: number): Freshness;
}

export function createReplayGuard(
  opts: { windowMs?: number; maxPerPeer?: number; startedAt?: number } = {}
): ReplayGuard {
  const startedAt = opts.startedAt ?? Date.now();
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
      if (ts < startedAt) return "stale";
      if (now - sweptAt > windowMs) {
        sweptAt = now;
        for (const nonces of seen.values()) sweep(nonces, now);
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
      nonces.set(nonce, ts + windowMs);
      return "ok";
    },
  };
}
