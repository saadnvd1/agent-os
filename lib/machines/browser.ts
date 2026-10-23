/**
 * Which machine the browser is on, when the request says. Only what the
 * server itself saw counts: the gate's trust verdict (loopback means an
 * unproxied request from this machine) and the socket's remote address.
 * Through Connect or a proxy the address is the tunnel's, so nothing is
 * claimed and the person says so once per browser instead.
 */

import { plainAddress } from "../security/auth";

export interface BrowserMachine {
  /** "local", a host id, or null when it can't be told. */
  hostId: string | null;
  how: "loopback" | "address" | null;
}

export interface KnownMachine {
  hostId: string;
  addresses: string[];
}

export function browserMachine(
  trust: string | null,
  remote: string | null,
  own: string[],
  others: KnownMachine[]
): BrowserMachine {
  if (trust === "loopback") return { hostId: "local", how: "loopback" };
  const addr = plainAddress(remote ?? "");
  if (!addr || ["connect", "peer", "unknown"].includes(addr))
    return { hostId: null, how: null };
  if (own.includes(addr)) return { hostId: "local", how: "address" };
  const hit = others.find((m) => m.addresses.includes(addr));
  return hit
    ? { hostId: hit.hostId, how: "address" }
    : { hostId: null, how: null };
}
