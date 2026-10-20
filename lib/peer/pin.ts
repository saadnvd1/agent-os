/**
 * Pins a machine after pairing: its keys on a Connect host of its own, the
 * one it already has if it paired before (a re-pair replaces the keys).
 */

import { createConnectHost, listRemoteHosts } from "../hosts";
import { pinForMachine, savePin } from "./links";

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

export function pinPeer(p: Paired): string {
  const hostId =
    pinForMachine(p.id)?.hostId ?? createConnectHost(freeName(p.name)).id;
  savePin({
    hostId,
    machineId: p.id,
    hostname: p.hostname,
    signPub: p.signPub,
    boxPub: p.boxPub,
  });
  return hostId;
}
