/**
 * The per-boot secret the rpc server's loopback hop carries, so the gate
 * knows a request is a verified peer call and not this machine itself.
 * Held on globalThis: server.ts and the gate must share one value.
 */

import crypto from "crypto";

const g = globalThis as unknown as { __agentosPeerSecret?: string };

export function peerSecret(): string {
  g.__agentosPeerSecret ??= crypto.randomBytes(32).toString("hex");
  return g.__agentosPeerSecret;
}

/** Constant-time: how much of the secret matched never shows in timing. */
export function secretMatches(given: unknown, secret: string): boolean {
  if (typeof given !== "string" || !secret) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(secret);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
