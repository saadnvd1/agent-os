/**
 * A paired device's approval key: P-256, made in the phone's Secure Enclave
 * and unlocked by Face ID, Touch ID or the passcode. Only the public key is
 * kept, in the passkeys table (type 'device', rp_id device:<id>).
 */

import crypto from "crypto";
import { getDb } from "@/lib/db";
import type { PasskeyRow } from "./passkeys";

// The fixed prefix of a P-256 SubjectPublicKeyInfo; the 65-byte X9.63 point
// follows it.
const SPKI_P256_PREFIX = Buffer.from(
  "3059301306072a8648ce3d020106082a8648ce3d030107034200",
  "hex"
);

export const newDeviceKeyId = () =>
  crypto.randomBytes(16).toString("base64url");

// The app sends the key as an uncompressed X9.63 point. Throws unless it's a
// real point on the curve.
export function spkiFromRawP256(raw: Buffer): Buffer {
  if (raw.length !== 65 || raw[0] !== 0x04)
    throw new Error("Not a P-256 public key");
  const spki = Buffer.concat([SPKI_P256_PREFIX, raw]);
  crypto.createPublicKey({ key: spki, format: "der", type: "spki" });
  return spki;
}

// iOS signs with ecdsaSignatureMessageX962SHA256, which is DER.
export function verifyDeviceSignature(
  spki: Buffer,
  message: string,
  signature: Buffer
): boolean {
  try {
    return crypto.verify(
      "sha256",
      Buffer.from(message),
      { key: spki, format: "der", type: "spki", dsaEncoding: "der" },
      signature
    );
  } catch {
    return false;
  }
}

export function activeDeviceKey(deviceId: string): PasskeyRow | null {
  return (
    (getDb()
      .prepare(
        `SELECT * FROM passkeys WHERE type = 'device' AND device_id = ? AND revoked_at IS NULL`
      )
      .get(deviceId) as PasskeyRow | undefined) ?? null
  );
}

// Revokes every active key of this device; returns them so the caller can
// raise the "revoked" asks.
export function revokeDeviceKeys(deviceId: string): PasskeyRow[] {
  const keys = getDb()
    .prepare(
      `SELECT * FROM passkeys WHERE type = 'device' AND device_id = ? AND revoked_at IS NULL`
    )
    .all(deviceId) as PasskeyRow[];
  if (keys.length)
    getDb()
      .prepare(
        `UPDATE passkeys SET revoked_at = datetime('now')
         WHERE type = 'device' AND device_id = ? AND revoked_at IS NULL`
      )
      .run(deviceId);
  return keys;
}
