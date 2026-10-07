// Keeping a machine reachable: learn its addresses after connecting, and
// move to one that answers when the current one stops.
import { api, setFailover } from "~/lib/api/client";
import { probeMachine } from "~/lib/api/pairing";
import {
  endpointsFrom,
  failoverOrder,
  trusted,
  firstAnswering,
  type NetworkInfo,
} from "./endpoints";
import { getMachine, updateMachine, type Machine } from "./store";

export async function refreshEndpoints(machine: Machine): Promise<void> {
  try {
    const net = await api<NetworkInfo>(machine, "/api/devices/network", {
      timeoutMs: 8000,
    });
    const endpoints = endpointsFrom(net, machine.url);
    if (endpoints.join() !== (machine.endpoints ?? []).join())
      await updateMachine(machine.id, { endpoints });
  } catch {
    // The list we have stays; it's refreshed on the next connect.
  }
}

const inFlight = new Map<string, Promise<Machine | null>>();
const lastTry = new Map<string, number>();
const COOLDOWN_MS = 10_000;

export function failover(id: string): Promise<Machine | null> {
  const running = inFlight.get(id);
  if (running) return running;
  const machine = getMachine(id);
  if (!machine || (machine.endpoints?.length ?? 0) < 2)
    return Promise.resolve(null);
  if (Date.now() - (lastTry.get(id) ?? 0) < COOLDOWN_MS)
    return Promise.resolve(getMachine(id));
  lastTry.set(id, Date.now());
  const run = (async () => {
    // Only addresses that pass `trusted` (or the one the user chose) get the token.
    const order = failoverOrder(
      machine.endpoints!.filter(
        (e) => e === machine.id || e === machine.url || trusted(e)
      ),
      machine.url
    );
    const url = await firstAnswering(
      order,
      async (u) => (await probeMachine(u, machine.token)).state === "trusted"
    );
    if (url && url !== machine.url) await updateMachine(id, { url });
    return getMachine(id);
  })().finally(() => inFlight.delete(id));
  inFlight.set(id, run);
  return run;
}

setFailover(failover);
