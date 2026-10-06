/**
 * The addresses another device can use to reach this AgentOS, best first:
 * Tailscale's name, then its IP, then Wi-Fi addresses we actually listen on.
 */

import { tailscaleStatus, type TailscaleState } from "@/lib/tailscale";
import { lanAddresses } from "./net";
import { lanEnabled } from "./network-settings";

export interface Reach {
  kind: "tailscale" | "lan";
  url: string;
}

export function reachFrom(
  ts: TailscaleState,
  lan: string[],
  port: number
): Reach[] {
  const out: Reach[] = [];
  if (ts.state === "running") {
    if (ts.dnsName)
      out.push({ kind: "tailscale", url: `http://${ts.dnsName}:${port}` });
    for (const ip of ts.ips)
      out.push({ kind: "tailscale", url: `http://${ip}:${port}` });
  }
  for (const ip of lan) out.push({ kind: "lan", url: `http://${ip}:${port}` });
  return out;
}

export async function reachableAt(): Promise<Reach[]> {
  const port = Number(process.env.AGENTOS_PORT || 3011);
  return reachFrom(
    await tailscaleStatus(),
    lanEnabled() ? lanAddresses() : [],
    port
  );
}
