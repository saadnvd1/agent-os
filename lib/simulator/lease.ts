/**
 * The simulator a task holds: one row per task, and the plan for what to
 * shut down or delete. The plan is pure so every branch is tested without
 * simctl.
 */

import { db } from "../db";
import { baseName, deviceNameFor, ownsDevice, type SimDevice } from "./simctl";

export type LeaseState =
  | "creating"
  | "starting"
  | "ready"
  | "failed"
  | "shutdown";

export interface Lease {
  session_id: string;
  udid: string | null;
  name: string;
  state: LeaseState;
  error: string | null;
  created_at: number;
  last_used_at: number;
}

export const IDLE_MS = 15 * 60_000;

// Booted at once, across all tasks. A booted simulator and its Metro are
// gigabytes and a burst of CPU, so the Mac is not left to take as many as
// tasks ask for.
export const maxBooted = () => {
  const n = Number(process.env.AGENTOS_SIMULATOR_MAX);
  return Number.isInteger(n) && n >= 1 ? n : 2;
};

export const getLease = (sessionId: string): Lease | undefined =>
  db
    .prepare(`SELECT * FROM simulator_leases WHERE session_id = ?`)
    .get(sessionId) as Lease | undefined;

export const allLeases = (): Lease[] =>
  db.prepare(`SELECT * FROM simulator_leases`).all() as Lease[];

export function putLease(
  sessionId: string,
  fields: {
    name?: string;
    udid?: string | null;
    state: LeaseState;
    error?: string | null;
  },
  now = Date.now()
): void {
  db.prepare(
    `INSERT INTO simulator_leases (session_id, udid, name, state, error, created_at, last_used_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(session_id) DO UPDATE SET
       udid = COALESCE(excluded.udid, udid),
       state = excluded.state,
       error = excluded.error,
       last_used_at = excluded.last_used_at`
  ).run(
    sessionId,
    fields.udid ?? null,
    fields.name ?? "",
    fields.state,
    fields.error ?? null,
    now,
    now
  );
}

export const touchLease = (sessionId: string, now = Date.now()) =>
  db
    .prepare(
      `UPDATE simulator_leases SET last_used_at = ? WHERE session_id = ?`
    )
    .run(now, sessionId);

export const dropLease = (sessionId: string) =>
  db
    .prepare(`DELETE FROM simulator_leases WHERE session_id = ?`)
    .run(sessionId);

// Leases that hold a booted (or booting) device, other than `except`.
export const bootedCount = (except?: string): number =>
  (
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM simulator_leases
         WHERE state IN ('creating', 'starting', 'ready') AND session_id != ?`
      )
      .get(except ?? "") as { n: number }
  ).n;

export interface SessionFacts {
  // Gone, done, dropped, merged, moved or archived: nothing will use it again.
  ended: boolean;
}

export interface SweepPlan {
  // Devices to delete, with the lease to drop (null for a device with none).
  remove: {
    device: { udid: string; name: string };
    sessionId: string | null;
  }[];
  shutdown: { udid: string; name: string; sessionId: string }[];
  // Leases left 'creating' or 'starting' by a bring-up that is no longer
  // running (a restart): to be marked failed, their device shut down.
  interrupted: {
    sessionId: string;
    name: string;
    device: { udid: string; name: string } | null;
  }[];
  // Leases whose device is gone.
  dropLeases: string[];
}

export function planSweep(
  leases: Lease[],
  devices: SimDevice[],
  sessions: Map<string, SessionFacts>,
  now: number,
  idleMs = IDLE_MS,
  // Tasks whose bring-up is running in this process right now.
  bringingUp: ReadonlySet<string> = new Set()
): SweepPlan {
  const plan: SweepPlan = {
    remove: [],
    shutdown: [],
    interrupted: [],
    dropLeases: [],
  };
  const byName = new Map(devices.map((d) => [d.name, d]));
  const leased = new Set(leases.map((l) => l.name));
  for (const id of bringingUp) leased.add(deviceNameFor(id));
  for (const lease of leases) {
    const device = byName.get(lease.name);
    const ended = sessions.get(lease.session_id)?.ended ?? true;
    const coming = lease.state === "creating" || lease.state === "starting";
    if (!ended && coming) {
      if (!bringingUp.has(lease.session_id))
        plan.interrupted.push({
          sessionId: lease.session_id,
          name: lease.name,
          device: device ? { udid: device.udid, name: device.name } : null,
        });
      continue;
    }
    if (!device) {
      plan.dropLeases.push(lease.session_id);
    } else if (ended || lease.state === "failed") {
      plan.remove.push({ device, sessionId: lease.session_id });
    } else if (
      device.state === "Booted" &&
      lease.state !== "starting" &&
      now - lease.last_used_at > idleMs
    ) {
      plan.shutdown.push({ ...device, sessionId: lease.session_id });
    }
  }
  // This instance's devices that no lease names: a database reset, or a crash
  // between making a device and recording it. The base is kept.
  for (const d of devices)
    if (ownsDevice(d.name) && d.name !== baseName() && !leased.has(d.name))
      plan.remove.push({ device: d, sessionId: null });
  return plan;
}
