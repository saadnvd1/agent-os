// The claims exchange between linked machines: one request carries our claims
// and brings back theirs. The side that holds the link does the calling, so
// it works when only one machine can reach the other.

import { hostApi, HostApiError, type HostLink } from "../hosts/remote-api";
import { claimsShared, machineId, machineName } from "./machine";
import { exchangeTargets, peerMachineOf, rememberPeer } from "./peers";
import { upsertRemote, wireFor } from "./store";
import { exchangeBody, type ExchangeBody } from "./types";

const OLD_PEER_MS = 60 * 60_000;
const skipUntil = new Map<string, number>();
const failing = new Set<string>();

export const selfMachine = () => ({ id: machineId(), name: machineName() });

// Takes what a peer sent; returns how many claims were new or newer.
// viaHost is the link it arrived through, when we know it.
export function acceptExchange(
  body: ExchangeBody,
  viaHost: string | null = null,
  now = Date.now()
): number {
  if (!claimsShared()) return 0;
  const self = machineId();
  if (body.machine.id === self) return 0;
  let n = 0;
  for (const c of body.claims)
    if (upsertRemote(self, body.machine.id, c, now, viaHost)) n++;
  return n;
}

// What we answer a peer that called: our claims, not echoed back to it.
export function answerExchange(body: ExchangeBody): ExchangeBody {
  const self = selfMachine();
  return {
    machine: self,
    claims: claimsShared()
      ? wireFor(self.id, { machineId: body.machine.id })
      : [],
  };
}

async function exchangeOver(
  link: HostLink,
  self: { id: string; name: string },
  log: (line: string) => void
): Promise<boolean> {
  const hostId = link.hostId;
  if ((skipUntil.get(hostId) ?? 0) > Date.now()) return false;
  try {
    const raw = await hostApi<unknown>(link, "/api/claims/exchange", {
      body: {
        machine: self,
        claims: wireFor(self.id, { machineId: peerMachineOf(hostId) }),
      },
      timeout: 8000,
    });
    const parsed = exchangeBody.safeParse(raw);
    if (!parsed.success) throw new Error("its answer wasn't claims");
    rememberPeer(hostId, parsed.data.machine.id);
    acceptExchange(parsed.data, hostId);
    failing.delete(hostId);
    return true;
  } catch (err) {
    if (err instanceof HostApiError && err.status === 404) {
      skipUntil.set(hostId, Date.now() + OLD_PEER_MS);
      return false;
    }
    if (!failing.has(hostId)) {
      failing.add(hostId);
      log(
        `claims: ${link.hostName} didn't answer: ${(err as Error)?.message ?? err}`
      );
    }
    return false;
  }
}

// Each machine once per tick, over its best working link.
export async function syncPeers(
  log: (line: string) => void = () => {}
): Promise<void> {
  if (!claimsShared()) return;
  const self = selfMachine();
  await Promise.all(
    exchangeTargets().map(async (links) => {
      for (const link of links) if (await exchangeOver(link, self, log)) return;
    })
  );
}
