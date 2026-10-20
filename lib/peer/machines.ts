/**
 * What Machines shows under "On your AgentOS account": the account's other
 * machines, each with whether it's linked here, and the plan.
 */

import { getDb } from "../db";
import { accountView } from "./account";
import type { Entitlements } from "../connect/control-api";

export interface AccountMachine {
  id: string;
  name: string;
  hostname: string;
  online: boolean;
  lastSeenAt: string | null;
  version: string | null;
  /** The Machines host it's linked as, when it is. */
  hostId: string | null;
  linkState: "active" | "suspended" | null;
  suspendedReason: string | null;
}

export interface AccountMachines {
  enrolled: boolean;
  entitlements: Entitlements | null;
  fetchedAt: number;
  error: string | null;
  /** Set when the service hasn't answered for a day: since when. */
  uncheckedSince: number | null;
  machines: AccountMachine[];
}

// The service shows a machine online for three missed beats.
const ONLINE_MS = 3 * 60_000;

export async function accountMachines(
  refresh = false,
  now = Date.now()
): Promise<AccountMachines> {
  const view = await accountView(refresh ? 0 : undefined);
  const pins = new Map(
    (
      getDb()
        .prepare(
          `SELECT p.machine_id, p.host_id, p.state, p.suspended_reason
           FROM peer_links p
           JOIN hosts h ON h.id = p.host_id WHERE h.kind = 'connect'`
        )
        .all() as {
        machine_id: string;
        host_id: string;
        state: string;
        suspended_reason: string | null;
      }[]
    ).map((r) => [r.machine_id, r])
  );
  return {
    enrolled: view.enrolled,
    entitlements: view.entitlements,
    fetchedAt: view.fetchedAt,
    error: view.error,
    uncheckedSince: view.uncheckedSince,
    machines: view.peers.map((p) => {
      const pin = pins.get(p.id);
      const seen = p.lastSeenAt ? Date.parse(p.lastSeenAt) : NaN;
      return {
        id: p.id,
        name: p.name,
        hostname: p.hostname,
        online: Number.isFinite(seen) && now - seen < ONLINE_MS,
        lastSeenAt: p.lastSeenAt,
        version: p.version,
        hostId: pin?.host_id ?? null,
        linkState: pin
          ? pin.state === "active"
            ? "active"
            : "suspended"
          : null,
        suspendedReason:
          pin && pin.state !== "active" ? pin.suspended_reason : null,
      };
    }),
  };
}
