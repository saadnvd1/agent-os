/**
 * The addresses another device can use to reach this AgentOS, best first:
 * Connect, then Tailscale's name, then its IP, then Wi-Fi addresses we listen on.
 */

import { tailscaleStatus, type TailscaleState } from "@/lib/tailscale";
import { lanAddresses } from "./net";
import { lanEnabled } from "./network-settings";
import { loadConnect } from "@/lib/connect/config";
import { tailnetHttpsUrl } from "./tailnet-https";

export interface Reach {
  kind: "connect" | "tailscale" | "lan";
  url: string;
}

export function reachFrom(
  ts: TailscaleState,
  lan: string[],
  port: number,
  connectHost: string | null = null,
  tailnetHttps: string | null = null
): Reach[] {
  // Connect works from anywhere, with HTTPS, and needs nothing on the phone.
  const out: Reach[] = connectHost
    ? [{ kind: "connect", url: `https://${connectHost}` }]
    : [];
  // HTTPS on the tailnet first: it's what passkeys and the clipboard need.
  if (ts.state === "running" && tailnetHttps)
    out.push({ kind: "tailscale", url: tailnetHttps });
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
    port,
    loadConnect()?.config.hostname ?? null,
    tailnetHttpsUrl()
  );
}
