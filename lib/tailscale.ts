/**
 * What Tailscale says about this machine, for showing the right URL or the
 * next setup step. Read-only: AgentOS never configures Tailscale itself.
 */

import { execFile } from "child_process";
import fs from "fs";
import { setKnownTailscaleIps, tailscaleAddresses } from "@/lib/security/net";

export type TailscaleState =
  | { state: "running"; ips: string[]; dnsName: string | null; https: boolean }
  | { state: "logged-out" }
  | { state: "missing" }
  // No CLI found, but an address in 100.64/10 exists. Other VPNs use that
  // range too, so this is only "might be Tailscale".
  | { state: "unknown"; ips: string[] };

const CANDIDATES = [
  "/Applications/Tailscale.app/Contents/MacOS/Tailscale",
  "/usr/local/bin/tailscale",
  "/opt/homebrew/bin/tailscale",
  "/usr/bin/tailscale",
];
const CACHE_MS = 30_000;

let cached: { at: number; value: TailscaleState } | null = null;

export function tailscaleBinary(): string | null {
  for (const dir of (process.env.PATH ?? "").split(":")) {
    const p = `${dir}/tailscale`;
    if (dir && fs.existsSync(p)) return p;
  }
  return CANDIDATES.find((p) => fs.existsSync(p)) ?? null;
}

function run(bin: string): Promise<string | null> {
  return new Promise((resolve) =>
    execFile(bin, ["status", "--json"], { timeout: 3000 }, (err, stdout) =>
      // `status` exits non-zero when logged out but still prints JSON.
      resolve(stdout || (err ? null : ""))
    )
  );
}

interface StatusJson {
  BackendState?: string;
  Self?: { DNSName?: string; TailscaleIPs?: string[] };
  CertDomains?: string[] | null;
}

export function parseStatus(raw: string): TailscaleState {
  const s = JSON.parse(raw) as StatusJson;
  if (s.BackendState !== "Running") return { state: "logged-out" };
  const dnsName = s.Self?.DNSName?.replace(/\.$/, "") || null;
  return {
    state: "running",
    ips: (s.Self?.TailscaleIPs ?? []).filter((ip) => !ip.includes(":")),
    dnsName,
    https: !!dnsName && (s.CertDomains ?? []).includes(dnsName),
  };
}

export async function tailscaleStatus(): Promise<TailscaleState> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.value;
  const bin = tailscaleBinary();
  let value: TailscaleState;
  if (!bin) {
    const ips = tailscaleAddresses();
    value = ips.length ? { state: "unknown", ips } : { state: "missing" };
  } else {
    const raw = await run(bin);
    try {
      value = raw ? parseStatus(raw) : { state: "logged-out" };
    } catch {
      value = { state: "logged-out" };
    }
  }
  if (value.state === "running") setKnownTailscaleIps(value.ips);
  cached = { at: Date.now(), value };
  return value;
}
