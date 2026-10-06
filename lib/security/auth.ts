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
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);
// A proxy must send one of these, or it looks like this machine itself.
// Proxies that send none need AGENTOS_AUTH, see README "Security".
const FORWARDING = new Set([
  "forwarded",
  "via",
  "x-real-ip",
  "x-client-ip",
  "true-client-ip",
  "x-original-forwarded-for",
]);
const FORWARDING_PREFIXES = ["x-forwarded-", "cf-", "tailscale-"];

// Reached without a token: the pairing page, what it needs to render, and
// the claim it posts. Exact paths, plus a few static asset folders whose
// paths may only use plain characters (no traversal, no encoding).
const PUBLIC_EXACT = new Set([
  "/pair",
  "/api/pair/claim",
  "/manifest.webmanifest",
  "/manifest.json",
  "/favicon.ico",
  "/icon.svg",
]);
const PUBLIC_PREFIXES = ["/_next/static/", "/icons/", "/serwist/"];
const PLAIN_PATH = /^\/[A-Za-z0-9._~\-/]*$/;

export const plainAddress = (a?: string) => (a ?? "").replace(/^::ffff:/, "");

export function proxied(headers: IncomingHttpHeaders): boolean {
  return Object.keys(headers).some(
    (h) => FORWARDING.has(h) || FORWARDING_PREFIXES.some((p) => h.startsWith(p))
  );
}

function hostName(host?: string): string {
  const h = (host ?? "").trim().toLowerCase();
  if (h.startsWith("[")) return h.slice(1, h.indexOf("]"));
  return h.replace(/:\d+$/, "");
}

export function isPublicPath(url?: string): boolean {
  const path = (url ?? "/").split("?")[0];
  if (!PLAIN_PATH.test(path) || path.includes("..") || path.includes("//")) {
    return false;
  }
  if (PUBLIC_EXACT.has(path) || /^\/apple-touch-icon[\w-]*\.png$/.test(path)) {
    return true;
  }
  return PUBLIC_PREFIXES.some((p) => path.startsWith(p));
}

export function cookieToken(headers: IncomingHttpHeaders): string | null {
  for (const part of (headers.cookie ?? "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k !== DEVICE_COOKIE) continue;
    try {
      return decodeURIComponent(v.join("=")) || null;
    } catch {
      return null;
    }
  }
  return null;
}

export function readToken(headers: IncomingHttpHeaders): string | null {
  const auth = headers.authorization;
  if (auth?.startsWith("Bearer ")) return auth.slice(7).trim() || null;
  return cookieToken(headers);
}

/** Where the request came from, before any token. */
export function networkTrust(
  req: Pick<AuthRequest, "headers" | "remoteAddress" | "localAddress">,
  policy: Pick<AuthPolicy, "tailnet" | "requireOnTailnet">
): Trust | null {
  const remote = plainAddress(req.remoteAddress);
  const local = plainAddress(req.localAddress);
  // A proxy on this machine connects from loopback on behalf of someone
  // else, and a DNS-rebinding page reaches loopback under a foreign name:
  // neither is this machine itself.
  if (
    LOOPBACK.has(remote) &&
    LOOPBACK_HOSTS.has(hostName(req.headers.host)) &&
    !proxied(req.headers)
  ) {
    return "loopback";
  }
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

/** Deny by default: anything that throws while deciding is a refusal. */
export function authorize(req: AuthRequest, policy: AuthPolicy): AuthResult {
  try {
    return decide(req, policy);
  } catch {
    return { ok: false };
  }
}

function decide(req: AuthRequest, policy: AuthPolicy): AuthResult {
  const trusted = networkTrust(req, policy);
  if (trusted) return { ok: true, via: trusted };
  const token = readToken(req.headers);
  const device = token ? policy.lookup(token) : null;
  if (device) return { ok: true, via: "device", deviceId: device.id };
  // AGENTOS_AUTH=off is for a login proxy on this side of the network. A
  // Connect stream has no socket address and must never be let in by it.
  if (policy.off && req.remoteAddress) return { ok: true, via: "open" };
  return { ok: false };
}
