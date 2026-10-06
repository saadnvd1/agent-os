/**
 * The request/upgrade gate server.ts runs after net.ts: decides with auth.ts,
 * stamps the result on the request for API routes, and answers refusals.
 */

import type { IncomingMessage, ServerResponse } from "http";
import type { Duplex } from "stream";
import {
  authorize,
  isPublicPath,
  plainAddress,
  DEVICE_HEADER,
  TRUST_HEADER,
  REMOTE_HEADER,
  type AuthPolicy,
  type AuthResult,
} from "./auth";
import { deviceForToken, touchDevice, trackDeviceSocket } from "./devices";
import { tailscaleAddresses } from "./net";
import { networkSetting } from "./network-settings";

export function authPolicy(env = process.env): AuthPolicy {
  return {
    get tailnet() {
      return tailscaleAddresses();
    },
    get requireOnTailnet() {
      return networkSetting("require_pairing_on_tailnet");
    },
    off: env.AGENTOS_AUTH === "off",
    lookup: deviceForToken,
  };
}

function check(req: IncomingMessage, policy: AuthPolicy): AuthResult {
  // Never trust a client-supplied verdict.
  delete req.headers[DEVICE_HEADER];
  delete req.headers[TRUST_HEADER];
  req.headers[REMOTE_HEADER] = plainAddress(req.socket.remoteAddress);
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
    if (result.deviceId) {
      req.headers[DEVICE_HEADER] = result.deviceId;
      touchDevice(result.deviceId, plainAddress(req.socket.remoteAddress));
    }
  }
  return result;
}

/** Returns true when the request may go on to Next. */
export function gateRequest(
  req: IncomingMessage,
  res: ServerResponse,
  policy: AuthPolicy
): boolean {
  if (check(req, policy).ok || isPublicPath(req.url)) return true;
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
  if (result.deviceId) trackDeviceSocket(result.deviceId, socket);
  return true;
}
