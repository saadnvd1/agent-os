/**
 * Pinned peers: a machine linked through Connect, by its Connect id, with
 * the keys it paired with. Nothing here talks to the network.
 */

import { getDb } from "../db";

export type PinState = "active" | "suspended";

export interface PeerPin {
  hostId: string;
  machineId: string;
  hostname: string;
  signPub: string;
  boxPub: string;
  state: PinState;
  suspendedReason: string | null;
}

interface Row {
  host_id: string;
  machine_id: string;
  hostname: string;
  sign_pub: string;
  box_pub: string;
  state: string;
  suspended_reason: string | null;
}

const toPin = (r: Row | undefined): PeerPin | null =>
  r
    ? {
        hostId: r.host_id,
        machineId: r.machine_id,
        hostname: r.hostname,
        signPub: r.sign_pub,
        boxPub: r.box_pub,
        state: r.state === "active" ? "active" : "suspended",
        suspendedReason: r.suspended_reason,
      }
    : null;

// Only a host created as a Connect machine counts: a pin on any other row
// would be a second way in that nothing shows.
const SELECT = `SELECT p.* FROM peer_links p JOIN hosts h ON h.id = p.host_id
  WHERE h.kind = 'connect'`;

export const pinForMachine = (machineId: string): PeerPin | null =>
  toPin(
    getDb().prepare(`${SELECT} AND p.machine_id = ?`).get(machineId) as
      Row | undefined
  );

/** Whether any linked machine may call in at all. */
export const hasActivePin = (): boolean =>
  getDb().prepare(`${SELECT} AND p.state = 'active' LIMIT 1`).get() !==
  undefined;

export const pinForHost = (hostId: string): PeerPin | null =>
  toPin(
    getDb().prepare(`${SELECT} AND p.host_id = ?`).get(hostId) as
      Row | undefined
  );

/** Pins a peer's keys to a Connect host. Pairing (S2) is the only caller. */
export function savePin(pin: Omit<PeerPin, "state" | "suspendedReason">) {
  const db = getDb();
  db.prepare(`DELETE FROM peer_unlinked WHERE machine_id = ?`).run(
    pin.machineId
  );
  db.prepare(
    `INSERT INTO peer_links (host_id, machine_id, hostname, sign_pub, box_pub)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(host_id) DO UPDATE SET machine_id = excluded.machine_id,
         hostname = excluded.hostname, sign_pub = excluded.sign_pub,
         box_pub = excluded.box_pub, state = 'active', suspended_reason = NULL,
         paired_at = datetime('now'), last_error = NULL`
  ).run(pin.hostId, pin.machineId, pin.hostname, pin.signPub, pin.boxPub);
}

export function suspendPin(hostId: string, reason: string) {
  getDb()
    .prepare(
      `UPDATE peer_links SET state = 'suspended', suspended_reason = ? WHERE host_id = ?`
    )
    .run(reason, hostId);
}

export function resumePin(hostId: string) {
  getDb()
    .prepare(
      `UPDATE peer_links SET state = 'active', suspended_reason = NULL WHERE host_id = ?`
    )
    .run(hostId);
}

/** Every pin, for checking them against the account (revoke.ts). */
export const allPins = (): PeerPin[] =>
  (getDb().prepare(SELECT).all() as Row[]).map((r) => toPin(r)!);

/** How long an unlinked machine is still answered "unknown peer", signed. */
export const UNLINKED_KEEP_MS = 30 * 24 * 3_600_000;

export interface Unlinked {
  machineId: string;
  hostId: string | null;
  signPub: string;
  /** The other machine unlinked it, rather than a person here. */
  byPeer: boolean;
  reason: string;
  at: number;
}

interface UnlinkedRow {
  machine_id: string;
  host_id: string | null;
  sign_pub: string;
  by_peer: number;
  reason: string;
  at: number;
}

const toUnlinked = (r: UnlinkedRow | undefined): Unlinked | null =>
  r
    ? {
        machineId: r.machine_id,
        hostId: r.host_id,
        signPub: r.sign_pub,
        byPeer: r.by_peer === 1,
        reason: r.reason,
        at: r.at,
      }
    : null;

/** A machine unlinked here within the last 30 days, by its Connect id. */
export const unlinkedMachine = (
  machineId: string,
  now = Date.now()
): Unlinked | null =>
  toUnlinked(
    getDb()
      .prepare(`SELECT * FROM peer_unlinked WHERE machine_id = ? AND at > ?`)
      .get(machineId, now - UNLINKED_KEEP_MS) as UnlinkedRow | undefined
  );

export const unlinkedHost = (hostId: string): Unlinked | null =>
  toUnlinked(
    getDb()
      .prepare(
        `SELECT * FROM peer_unlinked WHERE host_id = ? ORDER BY at DESC LIMIT 1`
      )
      .get(hostId) as UnlinkedRow | undefined
  );

export const hasRecentUnlinked = (now = Date.now()): boolean =>
  getDb()
    .prepare(`SELECT 1 FROM peer_unlinked WHERE at > ? LIMIT 1`)
    .get(now - UNLINKED_KEEP_MS) !== undefined;

/**
 * Removes a pin, keeping its signing key as unlinked (see the migration).
 * The host stays: it may still hold sessions, and it says who unlinked it.
 */
export function dropPin(
  hostId: string,
  o: { byPeer: boolean; reason: string },
  now = Date.now()
): PeerPin | null {
  const pin = pinForHost(hostId);
  if (!pin) return null;
  const db = getDb();
  db.transaction(() => {
    db.prepare(`DELETE FROM peer_unlinked WHERE at <= ?`).run(
      now - UNLINKED_KEEP_MS
    );
    db.prepare(
      `INSERT INTO peer_unlinked (machine_id, host_id, sign_pub, by_peer, reason, at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(machine_id) DO UPDATE SET host_id = excluded.host_id,
         sign_pub = excluded.sign_pub, by_peer = excluded.by_peer,
         reason = excluded.reason, at = excluded.at`
    ).run(
      pin.machineId,
      hostId,
      pin.signPub,
      o.byPeer ? 1 : 0,
      o.reason.slice(0, 200),
      now
    );
    db.prepare(`DELETE FROM peer_links WHERE host_id = ?`).run(hostId);
  })();
  return pin;
}

/** Last outcome of a call to that peer, for Machines. */
export function notePinResult(hostId: string, error: string | null) {
  getDb()
    .prepare(
      error
        ? `UPDATE peer_links SET last_error = ? WHERE host_id = ?`
        : `UPDATE peer_links SET last_ok_at = datetime('now'), last_error = NULL WHERE host_id = ?`
    )
    .run(...(error ? [error.slice(0, 300), hostId] : [hostId]));
}

/** The other machine, `name`, unlinked this one: its signed call or refusal. */
export const unlinkedByPeer = (hostId: string, name: string): boolean =>
  dropPin(hostId, { byPeer: true, reason: `Unlinked by ${name}` }) !== null;
