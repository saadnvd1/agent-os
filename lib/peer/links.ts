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
  getDb()
    .prepare(
      `INSERT INTO peer_links (host_id, machine_id, hostname, sign_pub, box_pub)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(host_id) DO UPDATE SET machine_id = excluded.machine_id,
         hostname = excluded.hostname, sign_pub = excluded.sign_pub,
         box_pub = excluded.box_pub, state = 'active', suspended_reason = NULL,
         paired_at = datetime('now'), last_error = NULL`
    )
    .run(pin.hostId, pin.machineId, pin.hostname, pin.signPub, pin.boxPub);
}

export function suspendPin(hostId: string, reason: string) {
  getDb()
    .prepare(
      `UPDATE peer_links SET state = 'suspended', suspended_reason = ? WHERE host_id = ?`
    )
    .run(reason, hostId);
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
