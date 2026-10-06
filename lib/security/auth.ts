/**
 * Who may use AgentOS once a request has passed the host/origin checks in
 * net.ts. Loopback and the tailnet are trusted as before; anything else
 * (Wi-Fi, a reverse proxy, Connect) needs a paired device's token.
 */

import type { IncomingHttpHeaders } from "http";

export const DEVICE_COOKIE = "aos_device";
// Set by server.ts on every request after stripping any client-sent copy.
export const DEVICE_HEADER = "x-agentos-device";
export const TRUST_HEADER = "x-agentos-trust";
export const REMOTE_HEADER = "x-agentos-remote";

export type Trust = "loopback" | "tailnet" | "device" | "open";

export type AuthResult =
  | { ok: true; via: Trust; deviceId?: string }
  | { ok: false };

export interface AuthRequest {
  url?: string;
  headers: IncomingHttpHeaders;
  remoteAddress?: string;
  localAddress?: string;
}

export interface AuthPolicy {
  /** This machine's own Tailscale addresses. */
  tailnet: string[];
  /** Require a device token on the tailnet too. */
  requireOnTailnet?: boolean;
  /** AGENTOS_AUTH=off: someone else's proxy does the login. */
  off?: boolean;
  lookup: (token: string) => { id: string } | null;
}

const TAILSCALE_V4 = /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./;
const LOOPBACK = new Set(["127.0.0.1", "::1"]);
const FORWARDING = [
  "x-forwarded-for",
  "forwarded",
  "x-real-ip",
  "x-forwarded-host",
];

// Reached without a token: the pairing page, what it needs to render, and
// the claim it posts.
const PUBLIC_PREFIXES = [
  "/_next/static/",
  "/icons/",
  "/serwist/",
  "/pair",
  "/api/pair/claim",
];
const PUBLIC_FILES = new Set([
  "/manifest.webmanifest",
  "/manifest.json",
  "/favicon.ico",
  "/icon.svg",
]);

export const plainAddress = (a?: string) => (a ?? "").replace(/^::ffff:/, "");

function proxied(headers: IncomingHttpHeaders): boolean {
  return (
    FORWARDING.some((h) => headers[h] !== undefined) ||
    Object.keys(headers).some((h) => h.startsWith("tailscale-"))
  );
}

export function isPublicPath(url?: string): boolean {
  const path = (url ?? "/").split("?")[0];
  if (PUBLIC_FILES.has(path) || path.startsWith("/apple-touch-icon"))
    return true;
  return PUBLIC_PREFIXES.some(
    (p) => path === p || path.startsWith(p.endsWith("/") ? p : `${p}/`)
  );
}

export function readToken(headers: IncomingHttpHeaders): string | null {
  const auth = headers.authorization;
  if (auth?.startsWith("Bearer ")) return auth.slice(7).trim() || null;
  for (const part of (headers.cookie ?? "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === DEVICE_COOKIE) return decodeURIComponent(v.join("=")) || null;
  }
  return null;
}

/** Where the request came from, before any token. */
export function networkTrust(
  req: Pick<AuthRequest, "headers" | "remoteAddress" | "localAddress">,
  policy: Pick<AuthPolicy, "tailnet" | "requireOnTailnet">
): Trust | null {
  const remote = plainAddress(req.remoteAddress);
  const local = plainAddress(req.localAddress);
  // A proxy on this machine connects from loopback on behalf of someone else.
  if (LOOPBACK.has(remote) && !proxied(req.headers)) return "loopback";
  if (
    !policy.requireOnTailnet &&
    policy.tailnet.includes(local) &&
    TAILSCALE_V4.test(remote) &&
    !proxied(req.headers)
  ) {
    return "tailnet";
  }
  return null;
}

export function authorize(req: AuthRequest, policy: AuthPolicy): AuthResult {
  const trusted = networkTrust(req, policy);
  if (trusted) return { ok: true, via: trusted };
  const token = readToken(req.headers);
  const device = token ? policy.lookup(token) : null;
  if (device) return { ok: true, via: "device", deviceId: device.id };
  if (policy.off) return { ok: true, via: "open" };
  return { ok: false };
}
