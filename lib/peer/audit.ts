/**
 * Peer calls, in and out. Successful reads (the mirror polls every few
 * seconds) fold into one row per route per hour. Failures are capped per
 * minute so a flood can't fill the disk, in two budgets: envelopes refused
 * here before their sender was proven (anyone can send those), and
 * everything else (this machine's own failed calls, a linked machine's
 * denied routes), so a forger's flood never hides the second kind. Rows older than 30 days go, checked at most hourly.
 * Bookkeeping: a failure here never fails the call.
 */

import { getDb } from "../db";

export type Outcome =
  | "ok"
  | "denied_route"
  | "bad_envelope"
  | "too_large"
  | "too_slow"
  | "busy"
  | "bad_sig"
  | "stale"
  | "replay"
  | "unknown_peer"
  | "suspended";

export interface AuditEntry {
  hostId: string | null;
  machineId?: string | null;
  direction: "in" | "out";
  method: string;
  /** The route's template (/api/tasks/:id/merge), never the raw path. */
  route: string;
  status: number;
  ms: number;
  bytes: number;
  outcome: Outcome;
}

const HOUR = 3_600_000;
const RETAIN_MS = 30 * 24 * HOUR;
const FAILURES_PER_MINUTE = 30;

const state = { prunedAt: 0, minute: 0, forged: 0, other: 0 };

/** For tests: forget the prune time and the failure budget. */
export const resetAuditLimits = () => {
  state.prunedAt = 0;
  state.minute = 0;
  state.forged = 0;
  state.other = 0;
};

// Refusals of an inbound envelope that anyone could have sent: a stranger's,
// a forgery, a malformed or oversized one, or a captured one sent again.
const UNPROVEN: ReadonlySet<Outcome> = new Set([
  "bad_envelope",
  "too_large",
  "too_slow",
  "busy",
  "bad_sig",
  "unknown_peer",
  "suspended",
  "stale",
  "replay",
]);

function underFailureCap(e: AuditEntry, now: number): boolean {
  const minute = Math.floor(now / 60_000);
  if (minute !== state.minute) {
    state.minute = minute;
    state.forged = 0;
    state.other = 0;
  }
  const key =
    e.direction === "in" && UNPROVEN.has(e.outcome) ? "forged" : "other";
  return ++state[key] <= FAILURES_PER_MINUTE;
}

export function recordPeerCall(e: AuditEntry, now = Date.now()): void {
  try {
    if (e.outcome !== "ok" && !underFailureCap(e, now)) return;
    const db = getDb();
    if (now - state.prunedAt > HOUR) {
      state.prunedAt = now;
      db.prepare(`DELETE FROM peer_audit WHERE at < ?`).run(now - RETAIN_MS);
    }
    const machineId = e.machineId?.slice(0, 64) ?? null;
    const fold = e.method === "GET" && e.outcome === "ok" && e.status < 400;
    const bucket = fold ? String(Math.floor(now / HOUR)) : null;
    if (bucket) {
      const changed = db
        .prepare(
          `UPDATE peer_audit SET count = count + 1, at = ?, status = ?, ms = ?,
             bytes = bytes + ?
           WHERE host_id IS ? AND direction = ? AND route = ? AND bucket = ?`
        )
        .run(
          now,
          e.status,
          e.ms,
          e.bytes,
          e.hostId,
          e.direction,
          e.route,
          bucket
        );
      if (changed.changes > 0) return;
    }
    db.prepare(
      `INSERT INTO peer_audit (at, host_id, machine_id, direction, method, route,
         status, ms, bytes, outcome, bucket)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      now,
      e.hostId,
      machineId,
      e.direction,
      e.method.slice(0, 10),
      e.route.slice(0, 200),
      e.status,
      Math.round(e.ms),
      e.bytes,
      e.outcome,
      bucket
    );
  } catch (err) {
    console.error("peer audit:", err);
  }
}

export interface AuditRow extends AuditEntry {
  at: number;
  count: number;
}

export function peerAudit(hostId: string, limit = 200): AuditRow[] {
  return getDb()
    .prepare(
      `SELECT at, host_id AS hostId, machine_id AS machineId, direction, method,
           route, status, ms, bytes, outcome, count
         FROM peer_audit WHERE host_id = ? ORDER BY at DESC, id DESC LIMIT ?`
    )
    .all(hostId, limit) as AuditRow[];
}
