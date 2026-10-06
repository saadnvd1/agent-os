/**
 * Who may reach AgentOS. It has no login and its terminal and /api/exec run
 * anything as the user, so it listens only on loopback and Tailscale, and it
 * refuses requests that name a foreign host (DNS rebinding) or come from
 * another site's page (drive-by requests from any website the user visits).
 */

import os from "os";

const TAILSCALE_V4 = /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./; // 100.64.0.0/10

// Tailscale's interface is tailscale0 on Linux and a utun on macOS. Other
// VPNs use 100.64/10 too, so the name must match, and once the tailscale CLI
// has reported this node's own IPs (lib/tailscale.ts), so must the address.
const TAILSCALE_IFACE = /^(tailscale\d*|utun\d+)$/;
const known = globalThis as unknown as { __agentosTailscaleIps?: string[] };
export const setKnownTailscaleIps = (ips: string[]) => {
  known.__agentosTailscaleIps = ips;
};

export function tailscaleAddresses(
  interfaces: NodeJS.Dict<os.NetworkInterfaceInfo[]> = os.networkInterfaces(),
  knownIps: string[] | undefined = known.__agentosTailscaleIps
): string[] {
  const out: string[] = [];
  for (const [name, infos] of Object.entries(interfaces)) {
    if (!TAILSCALE_IFACE.test(name)) continue;
    for (const i of infos ?? []) {
      if (i.family !== "IPv4" || !TAILSCALE_V4.test(i.address)) continue;
      if (knownIps?.length && !knownIps.includes(i.address)) continue;
      out.push(i.address);
    }
  }
  return out;
}

const PRIVATE_V4 = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/;

export function lanAddresses(
  interfaces: NodeJS.Dict<os.NetworkInterfaceInfo[]> = os.networkInterfaces()
): string[] {
  return Object.values(interfaces)
    .flat()
    .filter(
      (i): i is os.NetworkInterfaceInfo =>
        !!i && i.family === "IPv4" && !i.internal && PRIVATE_V4.test(i.address)
    )
    .map((i) => i.address);
}

// AGENTOS_BIND="0.0.0.0" (or a list) opts in to other networks. Wi-Fi access
// adds this machine's private addresses; every request from them needs a
// paired device (auth.ts).
export function bindAddresses(
  bind: string | undefined,
  interfaces?: NodeJS.Dict<os.NetworkInterfaceInfo[]>,
  lan = false
): string[] {
  if (bind?.trim()) {
    return bind
      .split(",")
      .map((a) => a.trim())
      .filter(Boolean);
  }
  return [
    "127.0.0.1",
    ...tailscaleAddresses(interfaces),
    ...(lan ? lanAddresses(interfaces) : []),
  ];
}

export interface AccessPolicy {
  bound: string[];
  extraHosts: string[];
}

const LOCAL_NAMES = new Set(["localhost", "127.0.0.1", "::1"]);

function hostname(hostOrUrlHost: string): string {
  const h = hostOrUrlHost.trim().toLowerCase();
  if (h.startsWith("[")) return h.slice(1, h.indexOf("]"));
  return h.replace(/:\d+$/, "");
}

export function hostAllowed(
  host: string | undefined,
  policy: AccessPolicy
): boolean {
  if (!host) return false;
  if (policy.bound.includes("0.0.0.0")) return true;
  const h = hostname(host);
  return (
    LOCAL_NAMES.has(h) ||
    policy.bound.includes(h) ||
    h.endsWith(".ts.net") ||
    policy.extraHosts.includes(h)
  );
}

export function originAllowed(
  origin: string | undefined,
  policy: AccessPolicy
): boolean {
  if (!origin) return true; // not a browser page: curl, aos, server-side
  if (origin === "null") return false;
  try {
    return hostAllowed(new URL(origin).host, policy);
  } catch {
    return false;
  }
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

// LumifyHub's approve page sends the browser back here, so this one URL is
// reached by a cross-site top-level navigation. It acts only on a `state`
// this instance issued, which a foreign page can't know.
const CROSS_SITE_NAVIGATIONS = ["/api/lumifyhub/callback"];

function crossSiteNavigationAllowed(req: {
  method?: string;
  url?: string;
  fetchMode?: string;
}): boolean {
  const path = (req.url ?? "").split("?")[0];
  return (
    (req.method ?? "GET").toUpperCase() === "GET" &&
    req.fetchMode === "navigate" &&
    CROSS_SITE_NAVIGATIONS.includes(path)
  );
}

export function requestAllowed(
  req: {
    method?: string;
    url?: string;
    host?: string;
    origin?: string;
    fetchSite?: string;
    fetchMode?: string;
  },
  policy: AccessPolicy
): boolean {
  if (!hostAllowed(req.host, policy)) return false;
  if (!req.url?.startsWith("/api/")) return true;
  if (req.fetchSite === "cross-site") return crossSiteNavigationAllowed(req);
  if (!SAFE_METHODS.has((req.method ?? "GET").toUpperCase())) {
    return originAllowed(req.origin, policy);
  }
  return true;
}

export function upgradeAllowed(
  req: { host?: string; origin?: string },
  policy: AccessPolicy
): boolean {
  return hostAllowed(req.host, policy) && originAllowed(req.origin, policy);
}
