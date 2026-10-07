// A machine's addresses (tailnet IP, tailnet HTTPS, Connect) and picking
// one that answers. The device token is the machine's, so it works on all.
import { normalizeMachineUrl } from "./url";

export interface NetworkInfo {
  reach?: { kind: string; url: string }[];
  connect?: { state?: string; hostname?: string | null } | null;
}

// What GET /api/devices/network says this machine is reachable at, best
// first, plus the address we already use; normalized and without repeats.
export function endpointsFrom(net: NetworkInfo, current: string): string[] {
  const raw = [
    ...(net.connect?.hostname &&
    net.connect.state &&
    net.connect.state !== "off"
      ? [`https://${net.connect.hostname}`]
      : []),
    ...(net.reach ?? []).map((r) => r.url),
    current,
  ];
  const out: string[] = [];
  for (const u of raw) {
    const p = normalizeMachineUrl(u);
    if (p.ok && !out.includes(p.url)) out.push(p.url);
  }
  return out;
}

// Try the address in use first, then the rest in the machine's order.
export function failoverOrder(endpoints: string[], current: string): string[] {
  return [current, ...endpoints.filter((e) => e !== current)];
}

// Probe all at once and take the first, in order, that answered: a slow
// preferred address beats a fast later one only while it answers in time.
export async function firstAnswering(
  order: string[],
  probe: (url: string) => Promise<boolean>
): Promise<string | null> {
  const results = await Promise.all(
    order.map((u) => probe(u).catch(() => false))
  );
  const i = results.indexOf(true);
  return i < 0 ? null : order[i];
}
