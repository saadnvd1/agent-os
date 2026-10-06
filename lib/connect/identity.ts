/**
 * A machine proves who it is to the relay with an Ed25519 key that never
 * leaves it. HELLO signs (machine id, time, nonce); the relay checks the
 * signature against the public key registered for that id, the time
 * against its clock, and refuses a nonce it has already seen.
 */

import crypto from "crypto";

const SKEW_MS = 60_000;
const CONTEXT = "agentos-connect-hello";

export interface Hello {
  machineId: string;
  ts: number;
  nonce: string;
  sig: string;
}

export function generateMachineKey(): {
  publicKey: string;
  privateKey: string;
} {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  return {
    publicKey: publicKey.export({ type: "spki", format: "pem" }).toString(),
    privateKey: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  };
}

const message = (h: Omit<Hello, "sig">) =>
  Buffer.from(`${CONTEXT}:${h.machineId}:${h.ts}:${h.nonce}`);

export function signHello(
  machineId: string,
  privateKeyPem: string,
  now = Date.now()
): Hello {
  const h = {
    machineId,
    ts: now,
    nonce: crypto.randomBytes(16).toString("base64url"),
  };
  const sig = crypto
    .sign(null, message(h), privateKeyPem)
    .toString("base64url");
  return { ...h, sig };
}

export class NonceCache {
  private seen = new Map<string, number>();
  /** False if this nonce was already used inside the window. */
  remember(nonce: string, now = Date.now()): boolean {
    for (const [n, at] of this.seen)
      if (at < now - 2 * SKEW_MS) this.seen.delete(n);
    if (this.seen.has(nonce)) return false;
    this.seen.set(nonce, now);
    return true;
  }
}

export type HelloCheck =
  | { ok: true; machineId: string }
  | { ok: false; error: string };

export function verifyHello(
  hello: Partial<Hello> | null,
  publicKeyPem: string | null,
  nonces: NonceCache,
  now = Date.now()
): HelloCheck {
  if (
    !hello?.machineId ||
    !hello.sig ||
    !hello.nonce ||
    typeof hello.ts !== "number"
  ) {
    return { ok: false, error: "malformed hello" };
  }
  if (!publicKeyPem) return { ok: false, error: "unknown machine" };
  if (Math.abs(now - hello.ts) > SKEW_MS)
    return { ok: false, error: "clock skew" };
  let valid = false;
  try {
    valid = crypto.verify(
      null,
      message(hello as Hello),
      publicKeyPem,
      Buffer.from(hello.sig, "base64url")
    );
  } catch {
    valid = false;
  }
  if (!valid) return { ok: false, error: "bad signature" };
  if (!nonces.remember(hello.nonce, now))
    return { ok: false, error: "replayed" };
  return { ok: true, machineId: hello.machineId };
}
