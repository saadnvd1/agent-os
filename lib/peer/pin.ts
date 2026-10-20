/**
 * Pins a machine after pairing: its keys on a Connect host of its own, the
 * one it already has if it paired before. A re-pair never changes the keys
 * of a pin: a machine whose keys changed is unlinked first, by a person.
 */

import { createConnectHost, getHost, listRemoteHosts } from "../hosts";
import { pinForMachine, savePin, unlinkedMachine } from "./links";

export interface Paired {
  id: string;
  name: string;
  hostname: string;
  signPub: string;
  boxPub: string;
}

/** A name no other machine here has, so `aos move <name>` stays clear. */
function freeName(name: string): string {
  const taken = new Set(listRemoteHosts().map((h) => h.name.toLowerCase()));
  if (!taken.has(name.toLowerCase()) && name.toLowerCase() !== "local")
    return name;
  for (let n = 2; ; n++)
    if (!taken.has(`${name} (${n})`.toLowerCase())) return `${name} (${n})`;
}

export const KEY_CHANGED =
  "This machine's keys changed since it was linked. Unlink it here first, then link it again.";

/** Whether a machine already linked here holds other keys than these. */
export function keysChanged(
  machineId: string,
  keys: { signPub: string; boxPub?: string }
): boolean {
  const pin = pinForMachine(machineId);
  return (
    !!pin &&
    (pin.signPub !== keys.signPub ||
      (keys.boxPub !== undefined && pin.boxPub !== keys.boxPub))
  );
}

export function pinPeer(p: Paired): string {
  const pinned = pinForMachine(p.id);
  if (keysChanged(p.id, p)) throw new Error(KEY_CHANGED);
  // Linked again after an unlink: back on the host it had, if it's still here.
  const was = unlinkedMachine(p.id)?.hostId;
  const reuse = was && getHost(was)?.kind === "connect" ? was : null;
  const hostId =
    pinned?.hostId ?? reuse ?? createConnectHost(freeName(p.name)).id;
  savePin({
    hostId,
    machineId: p.id,
    hostname: p.hostname,
    signPub: p.signPub,
    boxPub: p.boxPub,
  });
  return hostId;
}
