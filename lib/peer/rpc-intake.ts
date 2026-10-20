/**
 * Reading an envelope off the wire before anything about it is verified:
 * how much memory unverified envelopes may hold, and how slowly one may
 * arrive. Every sender, linked or not, goes through exactly this, so neither
 * the time to a refusal nor a `busy` says whether a machine is linked here.
 */

import type { IncomingMessage } from "http";
import { isIP } from "net";
import { isTunnelSocket } from "../security/auth";
import { MAX_HEADER, MAX_REQUEST_ENVELOPE, type Refusal } from "./envelope";

/** One request's share of the budget; close() gives back everything it took. */
export interface Ticket {
  take(peer: string, bytes: number): boolean;
  close(): void;
}

/**
 * Bytes held by envelopes whose signature isn't checked yet: in all, per
 * claimed sender, and per source address, plus how many such requests one
 * source may have open. Each share is well below the total, so one source
 * (or a forger claiming one peer) can't lock everyone out.
 */
export interface BodyBudget {
  open(source: string): Ticket | null;
}

export interface BudgetLimits {
  total: number;
  perPeer: number;
  perSource: number;
  requestsPerSource: number;
}

export const DEFAULT_BUDGET: BudgetLimits = {
  total: 4 * MAX_REQUEST_ENVELOPE,
  perPeer: MAX_REQUEST_ENVELOPE,
  perSource: MAX_REQUEST_ENVELOPE,
  requestsPerSource: 4,
};

export function createBodyBudget(o: Partial<BudgetLimits> = {}): BodyBudget {
  const lim = { ...DEFAULT_BUDGET, ...o };
  let used = 0;
  const byPeer = new Map<string, number>();
  const bySource = new Map<string, number>();
  const open = new Map<string, number>();
  const add = (m: Map<string, number>, k: string, n: number) => {
    const v = (m.get(k) ?? 0) + n;
    if (v > 0) m.set(k, v);
    else m.delete(k);
  };
  return {
    open(source) {
      if ((open.get(source) ?? 0) >= lim.requestsPerSource) return null;
      add(open, source, 1);
      const held = new Map<string, number>();
      let closed = false;
      return {
        take(peer, bytes) {
          if (closed) return false;
          if (
            used + bytes > lim.total ||
            (byPeer.get(peer) ?? 0) + bytes > lim.perPeer ||
            (bySource.get(source) ?? 0) + bytes > lim.perSource
          )
            return false;
          used += bytes;
          add(byPeer, peer, bytes);
          add(bySource, source, bytes);
          add(held, peer, bytes);
          return true;
        },
        close() {
          if (closed) return;
          closed = true;
          for (const [peer, bytes] of held) {
            used -= bytes;
            add(byPeer, peer, -bytes);
            add(bySource, source, -bytes);
          }
          add(open, source, -1);
        },
      };
    },
  };
}

/**
 * Where a request came from: the visitor's address Cloudflare stamps on a
 * tunnel request (the socket there is always cloudflared), else the socket's.
 */
export function sourceOf(req: IncomingMessage): string {
  if (isTunnelSocket(req.socket)) {
    const cf = String(req.headers["cf-connecting-ip"] ?? "").trim();
    if (isIP(cf)) return cf;
  }
  return req.socket.remoteAddress ?? "unknown";
}

export interface Pace {
  /** How long the first bytes may take before a rate is required. */
  graceMs: number;
  /** Bytes per second the body must average after the grace period. */
  minRate: number;
}

export const DEFAULT_PACE: Pace = { graceMs: 10_000, minRate: 512 * 1024 };

export type Read =
  | { body: Buffer }
  | { refusal: Refusal }
  | { tooLarge: true }
  | { tooSlow: true };

/**
 * The body, at most MAX_REQUEST_ENVELOPE bytes. `early` sees the header as
 * soon as it has arrived, and returns the claimed sender to charge or a
 * refusal. From then on every byte held must be granted by the ticket, or
 * reading stops as busy; a body slower than `pace` stops as too slow.
 */
export function readEnvelope(
  req: IncomingMessage,
  o: {
    early: (headerBytes: Buffer) => { peer: string } | { refusal: Refusal };
    ticket: Ticket;
    pace: Pace;
  }
): Promise<Read> {
  return new Promise((resolve, reject) => {
    if (Number(req.headers["content-length"]) > MAX_REQUEST_ENVELOPE)
      return resolve({ tooLarge: true });
    const chunks: Buffer[] = [];
    const started = Date.now();
    let total = 0;
    let peer: string | null = null;
    let done = false;
    const finish = (v: Read | Error) => {
      if (done) return;
      done = true;
      clearInterval(timer);
      // An unread rest is dropped with the connection (Connection: close).
      req.removeAllListeners("data");
      if (v instanceof Error) reject(v);
      else resolve(v);
    };
    const { graceMs, minRate } = o.pace;
    const timer = setInterval(
      () => {
        const late = Date.now() - started - graceMs;
        if (late > 0 && total < (late / 1000) * minRate)
          finish({ tooSlow: true });
      },
      Math.max(25, Math.min(1000, graceMs / 4))
    );
    req.on("data", (chunk: Buffer) => {
      if (done) return;
      total += chunk.length;
      if (total > MAX_REQUEST_ENVELOPE) return finish({ tooLarge: true });
      chunks.push(chunk);
      if (peer !== null) {
        if (!o.ticket.take(peer, chunk.length)) finish({ refusal: "busy" });
        return;
      }
      if (total < 4) return;
      const head = chunks.length === 1 ? chunks[0] : Buffer.concat(chunks);
      const len = head.readUInt32BE(0);
      if (len > MAX_HEADER) return finish({ refusal: "bad_envelope" });
      if (head.length < 4 + len) return;
      const seen = o.early(head.subarray(4, 4 + len));
      if ("refusal" in seen) return finish({ refusal: seen.refusal });
      peer = seen.peer;
      if (!o.ticket.take(peer, total)) finish({ refusal: "busy" });
    });
    req.on("end", () => {
      if (total >= 4 && peer === null && !done)
        return finish({ refusal: "bad_envelope" });
      finish({ body: Buffer.concat(chunks) });
    });
    req.on("error", (err) => finish(err));
  });
}
