/**
 * The request/upgrade gate server.ts runs after net.ts: decides with auth.ts,
 * stamps the result on the request for API routes, and answers refusals.
 */

import type { IncomingMessage, ServerResponse } from "http";
import type { Duplex } from "stream";
import {
  authorize,
  cookieToken,
  isPublicPath,
  plainAddress,
  DEVICE_HEADER,
  TRUST_HEADER,
  REMOTE_HEADER,
  type AuthPolicy,
  type AuthResult,
} from "./auth";
import { deviceCookie, isHttps } from "./cookie";
import { deviceForToken, touchDevice, trackDeviceSocket } from "./devices";
import { tailscaleAddresses } from "./net";
import { networkSetting } from "./network-settings";

// Interface addresses change rarely; don't re-read them on every request.
let tailnetCache = { at: 0, ips: [] as string[] };
function cachedTailnet(): string[] {
  if (Date.now() - tailnetCache.at > 5000) {
    tailnetCache = { at: Date.now(), ips: tailscaleAddresses() };
  }
  return tailnetCache.ips;
}

export function authPolicy(env = process.env): AuthPolicy {
  return {
    get tailnet() {
      return cachedTailnet();
    },
    get requireOnTailnet() {
      return networkSetting("require_pairing_on_tailnet");
    },
    off: env.AGENTOS_AUTH === "off",
    lookup: deviceForToken,
  };
}

// Connect streams have no address. Give them a fixed label so rate limits
// can't be steered by headers the caller chose.
export const sourceLabel = (remote?: string) =>
  plainAddress(remote) || "connect";

function decide(req: IncomingMessage, policy: AuthPolicy): AuthResult {
  // Never trust a client-supplied verdict.
  delete req.headers[DEVICE_HEADER];
  delete req.headers[TRUST_HEADER];
  req.headers[REMOTE_HEADER] = sourceLabel(req.socket.remoteAddress);
  const result = authorize(
    {
      url: req.url,
      headers: req.headers,
      remoteAddress: req.socket.remoteAddress,
      localAddress: req.socket.localAddress,
    },
    policy
  );
  if (result.ok) {
    req.headers[TRUST_HEADER] = result.via;
    if (result.deviceId) req.headers[DEVICE_HEADER] = result.deviceId;
  }
  return result;
}

/** Deny by default: an exception while deciding refuses the request. */
function check(req: IncomingMessage, policy: AuthPolicy): AuthResult {
  try {
    return decide(req, policy);
  } catch (err) {
    console.error("access check failed:", err);
    delete req.headers[TRUST_HEADER];
    delete req.headers[DEVICE_HEADER];
    return { ok: false };
  }
}

/** Last-seen bookkeeping; never allowed to fail a request. */
function touch(req: IncomingMessage, deviceId: string): boolean {
  try {
    return touchDevice(deviceId, plainAddress(req.socket.remoteAddress));
  } catch {
    return false;
  }
}

/** Returns true when the request may go on to Next. */
export function gateRequest(
  req: IncomingMessage,
  res: ServerResponse,
  policy: AuthPolicy
): boolean {
  const result = check(req, policy);
  if (result.ok) {
    // Slide the cookie's expiry forward, at most once a minute per device.
    const cookie = result.deviceId ? cookieToken(req.headers) : null;
    if (result.deviceId && touch(req, result.deviceId) && cookie) {
      const encrypted = "encrypted" in req.socket && !!req.socket.encrypted;
      const proto = [req.headers["x-forwarded-proto"]].flat()[0];
      res.setHeader(
        "Set-Cookie",
        deviceCookie(cookie, isHttps(encrypted, proto))
      );
    }
    return true;
  }
  if (isPublicPath(req.url)) return true;
  const path = (req.url ?? "/").split("?")[0];
  const wantsPage =
    !path.startsWith("/api/") &&
    req.method === "GET" &&
    (req.headers.accept ?? "").includes("text/html");
  if (wantsPage) {
    res.statusCode = 302;
    res.setHeader("Location", "/pair");
  } else {
    res.statusCode = 401;
    res.setHeader("Content-Type", "application/json");
  }
  res.end(wantsPage ? "" : JSON.stringify({ error: "pairing required" }));
  return false;
}

/** Returns true when the upgrade may proceed; refuses it otherwise. */
export function gateUpgrade(
  req: IncomingMessage,
  socket: Duplex,
  policy: AuthPolicy
): boolean {
  const result = check(req, policy);
  if (!result.ok) {
    socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
    socket.destroy();
    return false;
  }
  if (result.deviceId) {
    touch(req, result.deviceId);
    trackDeviceSocket(result.deviceId, socket);
  }
  return true;
}
