/**
 * One-time pairing codes. A trusted device asks for one; a new device claims
 * it once, within ten minutes, and gets its own token. Codes live in memory
 * only (on globalThis: server.ts and route bundles load modules separately).
 */

import crypto from "crypto";
import { mintDevice, type Device } from "./devices";

const TTL_MS = 10 * 60_000;
// Crockford base32: no I, L, O, U, so a typed code can't be misread.
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const CLAIMS_PER_MINUTE = 10;
const CLAIMS_PER_MINUTE_TOTAL = 60;

interface Pending {
  expiresAt: number;
  claimed?: { deviceId: string; name: string };
}

interface PairingState {
  codes: Map<string, Pending>;
  attempts: Map<string, number[]>;
}
const g = globalThis as unknown as { __agentosPairing?: PairingState };
const state: PairingState = (g.__agentosPairing ??= {
  codes: new Map(),
  attempts: new Map(),
});

/** 16 characters, 80 bits, shown as XXXX-XXXX-XXXX-XXXX. */
function newCode(): string {
  const bytes = crypto.randomBytes(16);
  return Array.from(bytes, (b) => ALPHABET[b & 31]).join("");
}

export const formatCode = (code: string) => code.match(/.{4}/g)!.join("-");

export function normalizeCode(input: string): string {
  return input
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, "")
    .replace(/O/g, "0")
    .replace(/[IL]/g, "1");
}

function sweep(now = Date.now()): void {
  for (const [code, p] of state.codes) {
    if (p.expiresAt < now - TTL_MS) state.codes.delete(code);
  }
  for (const [key, times] of state.attempts) {
    if (times.every((t) => t <= now - 60_000)) state.attempts.delete(key);
  }
}

export function startPairing(now = Date.now()): {
  code: string;
  expiresAt: number;
} {
  sweep(now);
  const code = newCode();
  const expiresAt = now + TTL_MS;
  state.codes.set(code, { expiresAt });
  return { code, expiresAt };
}

export function pairingStatus(code: string, now = Date.now()) {
  const p = state.codes.get(normalizeCode(code));
  if (!p) return { state: "unknown" as const };
  if (p.claimed) return { state: "claimed" as const, name: p.claimed.name };
  if (p.expiresAt < now) return { state: "expired" as const };
  return { state: "waiting" as const, expiresAt: p.expiresAt };
}

export type ClaimResult =
  | { ok: true; device: Device; token: string }
  | { ok: false; error: "rate_limited" | "invalid" };

export function claimPairing(
  input: {
    code: string;
    name: string;
    userAgent?: string | null;
    address: string;
  },
  now = Date.now()
): ClaimResult {
  sweep(now);
  const total = [...state.attempts.values()].reduce(
    (n, times) => n + times.filter((t) => t > now - 60_000).length,
    0
  );
  if (total >= CLAIMS_PER_MINUTE_TOTAL)
    return { ok: false, error: "rate_limited" };
  const recent = (state.attempts.get(input.address) ?? []).filter(
    (t) => t > now - 60_000
  );
  recent.push(now);
  state.attempts.set(input.address, recent);
  if (recent.length > CLAIMS_PER_MINUTE)
    return { ok: false, error: "rate_limited" };

  const p = state.codes.get(normalizeCode(input.code));
  if (!p || p.claimed || p.expiresAt < now)
    return { ok: false, error: "invalid" };
  const { device, token } = mintDevice(input.name, input.userAgent);
  p.claimed = { deviceId: device.id, name: device.name };
  return { ok: true, device, token };
}
