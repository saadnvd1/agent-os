/**
 * Reading an envelope off the wire: how much memory envelopes may hold
 * before and after their sender is proven, and how slowly one may arrive.
 * The sender is proven by the header's own signature, before any of the
 * body is held for it. Every sender, linked or not, goes through exactly
 * this, so neither the time to a refusal nor a `busy` says whether a machine
 * is linked here.
 */

import type { IncomingMessage } from "http";
import { isIP } from "net";
import { isTunnelSocket } from "../security/auth";
import {
  HEADER_SIG,
  MAX_HEADER,
  MAX_REQUEST_ENVELOPE,
  type Refusal,
} from "./envelope";

/**
 * One request's share of the budget. Bytes are held against its source until
 * prove() names the sender whose header signature held, then against that
 * sender; close() gives back everything it took.
 */
export interface Ticket {
  take(bytes: number): boolean;
  prove(peer: string): boolean;
  close(): void;
}

/**
 * Bytes held by envelopes still arriving. Before the header's signature is
 * checked they count against the source address, in a small pool of their
 * own, so strangers can't touch what linked machines get; after, against
 * the proven sender. Each share is well below its total, and one source may
 * have only a few requests open.
 */
export interface BodyBudget {
  open(source: string): Ticket | null;
}

export interface BudgetLimits {
  /** Bytes of proven senders' envelopes, in all and per sender. */
  total: number;
  perPeer: number;
  /** Bytes not yet proven, in all and per source. */
  unverifiedTotal: number;
  perSource: number;
  requestsPerSource: number;
}

export const DEFAULT_BUDGET: BudgetLimits = {
  total: 4 * MAX_REQUEST_ENVELOPE,
  perPeer: MAX_REQUEST_ENVELOPE,
  unverifiedTotal: 4 * 1024 * 1024,
  perSource: 256 * 1024,
  requestsPerSource: 4,
};

export function createBodyBudget(o: Partial<BudgetLimits> = {}): BodyBudget {
  const lim = { ...DEFAULT_BUDGET, ...o };
  let proven = 0;
  let unproven = 0;
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
      let peer: string | null = null;
      let held = 0;
      let closed = false;
      const fits = (who: string | null, bytes: number) =>
        who === null
          ? unproven + bytes <= lim.unverifiedTotal &&
            (bySource.get(source) ?? 0) + bytes <= lim.perSource
          : proven + bytes <= lim.total &&
            (byPeer.get(who) ?? 0) + bytes <= lim.perPeer;
      const charge = (who: string | null, bytes: number) => {
        if (who === null) {
          unproven += bytes;
          add(bySource, source, bytes);
        } else {
          proven += bytes;
          add(byPeer, who, bytes);
        }
      };
      return {
        take(bytes) {
          if (closed || !fits(peer, bytes)) return false;
          charge(peer, bytes);
          held += bytes;
          return true;
        },
        prove(who) {
          if (closed || peer !== null || !fits(who, held)) return false;
          charge(null, -held);
          charge(who, held);
          peer = who;
          return true;
        },
        close() {
          if (closed) return;
          closed = true;
          charge(peer, -held);
          add(open, source, -1);
        },
      };
    },
  };
}

/**
 * Where a request came from: the visitor's address Cloudflare stamps on a
 * tunnel request (the socket there is always cloudflared), else the socket's.
 * An IPv6 address counts by its /64: one host is usually handed a whole one.
 */
export function sourceOf(req: IncomingMessage): string {
  let addr = req.socket.remoteAddress ?? "unknown";
  if (isTunnelSocket(req.socket)) {
    const cf = String(req.headers["cf-connecting-ip"] ?? "").trim();
    if (isIP(cf)) addr = cf;
  }
  return isIP(addr) === 6 ? ipv6Prefix64(addr) : addr;
}

/** The first four groups of an IPv6 address, expanded: its /64. */
export function ipv6Prefix64(addr: string): string {
  const plain = addr.split("%")[0].toLowerCase();
  if (/^::ffff:\d+\.\d+\.\d+\.\d+$/.test(plain)) return plain.slice(7);
  const [head, tail = ""] = plain.split("::");
  const a = head ? head.split(":") : [];
  const b = plain.includes("::") && tail ? tail.split(":") : [];
  // An embedded IPv4 tail takes two groups; it never reaches the first four
  // unless the address is mostly zeros, which then pads them.
  const fill = Array(Math.max(0, 8 - a.length - b.length)).fill("0");
  const groups = [...a, ...fill, ...b].slice(0, 4);
  return `${groups.map((g) => g.replace(/^0+(?=.)/, "")).join(":")}::/64`;
}

export interface Pace {
  /** How long the header and its signature may take: they fit in the
   * first packet, so a sender that holds them back is stalling. */
  headerMs: number;
  /** How long the first bytes may take before a rate is required. */
  graceMs: number;
  /** Bytes per second the body must keep up after the grace period, */
  minRate: number;
  /** measured over each window this long, so a burst can't bank time. */
  windowMs: number;
}

export const DEFAULT_PACE: Pace = {
  headerMs: 3_000,
  graceMs: 10_000,
  minRate: 512 * 1024,
  windowMs: 5_000,
};

export type Read =
  | { body: Buffer }
  | { refusal: Refusal }
  | { tooLarge: true }
  | { tooSlow: true };

/**
 * The body, at most MAX_REQUEST_ENVELOPE bytes. `early` sees the header and
 * its signature as soon as they've arrived, and returns the proven sender or
 * a refusal. Every byte held must be granted by the ticket, or reading stops
 * as busy; a body slower than `pace` stops as too slow.
 */
export function readEnvelope(
  req: IncomingMessage,
  o: {
    early: (
      headerBytes: Buffer,
      headerSig: Buffer
    ) => { peer: string } | { refusal: Refusal };
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
    let proven = false;
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
    const { headerMs, graceMs, minRate, windowMs } = o.pace;
    // (time, bytes so far), back to the start of the current window.
    const samples = [{ t: started, total: 0 }];
    const timer = setInterval(
      () => {
        const now = Date.now();
        samples.push({ t: now, total });
        while (samples.length > 1 && samples[1].t <= now - windowMs)
          samples.shift();
        if (!proven && now - started > headerMs)
          return finish({ tooSlow: true });
        if (now - started <= graceMs) return;
        const base = samples[0];
        if (total - base.total < ((now - base.t) / 1000) * minRate)
          finish({ tooSlow: true });
      },
      Math.max(25, Math.min(1000, headerMs / 4, graceMs / 4, windowMs / 4))
    );
    req.on("data", (chunk: Buffer) => {
      if (done) return;
      total += chunk.length;
      if (total > MAX_REQUEST_ENVELOPE) return finish({ tooLarge: true });
      if (!o.ticket.take(chunk.length)) return finish({ refusal: "busy" });
      chunks.push(chunk);
      if (proven || total < 4) return;
      const head = chunks.length === 1 ? chunks[0] : Buffer.concat(chunks);
      chunks.splice(0, chunks.length, head);
      const len = head.readUInt32BE(0);
      if (len > MAX_HEADER) return finish({ refusal: "bad_envelope" });
      if (head.length < 4 + len + HEADER_SIG) return;
      let seen;
      try {
        seen = o.early(
          head.subarray(4, 4 + len),
          head.subarray(4 + len, 4 + len + HEADER_SIG)
        );
      } catch {
        // A throw here would escape the 'data' handler and take the server
        // down; whatever failed (the database, say), the caller is told busy.
        return finish({ refusal: "busy" });
      }
      if ("refusal" in seen) return finish({ refusal: seen.refusal });
      if (!o.ticket.prove(seen.peer)) return finish({ refusal: "busy" });
      proven = true;
    });
    req.on("end", () => {
      if (total >= 4 && !proven && !done)
        return finish({ refusal: "bad_envelope" });
      finish({ body: Buffer.concat(chunks) });
    });
    req.on("error", (err) => finish(err));
  });
}
