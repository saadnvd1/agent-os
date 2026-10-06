/**
 * The device cookie. Lax, not Strict: a tapped notification or link must
 * arrive signed in; cross-site writes are refused by net.ts anyway.
 * One year, slid forward on use (gate.ts). Bearer tokens (AGENTOS_TOKEN for
 * aos and MCP) don't expire: they're for headless callers, and removing the
 * device in Devices revokes them at once.
 */

import { DEVICE_COOKIE } from "./auth";

export const DEVICE_COOKIE_MAX_AGE = 365 * 24 * 60 * 60;

export function deviceCookie(token: string, secure: boolean): string {
  return [
    `${DEVICE_COOKIE}=${encodeURIComponent(token)}`,
    "Path=/",
    `Max-Age=${DEVICE_COOKIE_MAX_AGE}`,
    "HttpOnly",
    "SameSite=Lax",
    ...(secure ? ["Secure"] : []),
  ].join("; ");
}

/** HTTPS directly, or a proxy in front saying so. */
export const isHttps = (encrypted: boolean, forwardedProto?: string | null) =>
  encrypted || forwardedProto?.split(",")[0].trim() === "https";
