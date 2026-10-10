/**
 * User presence: a WebAuthn assertion with user verification (Touch ID,
 * Face ID) on a challenge bound to the one thing being approved. Single
 * use, two minutes. Agents on this machine can reach every route, but they
 * can't make Saad's platform authenticator sign.
 *
 * Adding a passkey: the very first on this install is trust-on-first-use,
 * once (revoking every passkey doesn't re-open it; `agent-os passkeys
 * reset` does). Every registration and revoke raises an ask so a rogue one
 * can't go unseen. After the first, a new passkey needs an enrollment code
 * minted by an assertion from an existing one.
 */

import crypto from "crypto";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { getDb } from "@/lib/db";
import {
  activePasskeys,
  markBootstrapped,
  passkeysBootstrapped,
  addPasskey,
  getPasskey,
  touchPasskey,
  type PasskeyRow,
} from "./passkeys";

export const CHALLENGE_MS = 2 * 60 * 1000;
const ENROLL_MS = 10 * 60 * 1000;

export type PresencePurpose =
  | "approve"
  | "resume"
  | "enroll"
  | "revoke"
  | "approvals-off";

export class PresenceError extends Error {
  constructor(
    message: string,
    readonly code: "insecure" | "none" | "enroll" | "bad" = "bad"
  ) {
    super(message);
  }
}

export interface RelyingParty {
  rpID: string;
  origin: string;
}

const hostOf = (host: string | null) =>
  (host ?? "").trim().toLowerCase().replace(/:\d+$/, "");

// The page's own origin, which must be the host it was served on. Browsers
// offer passkeys only over https or on localhost.
export function relyingParty(headers: Headers): RelyingParty {
  const raw = headers.get("origin");
  if (!raw) throw new PresenceError("No origin on the request");
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new PresenceError("Bad origin");
  }
  if (url.hostname !== hostOf(headers.get("host")))
    throw new PresenceError("The origin doesn't match this host");
  if (url.protocol !== "https:" && url.hostname !== "localhost")
    throw new PresenceError(
      "Passkeys need https or localhost: approve this on the machine running AgentOS, or over Connect.",
      "insecure"
    );
  return { rpID: url.hostname, origin: url.origin };
}

const now = () => Date.now();

function storeChallenge(
  challenge: string,
  kind: "register" | "assert",
  purpose: string,
  binding: string,
  rpID: string
): void {
  getDb()
    .prepare(
      `INSERT INTO presence_challenges (challenge, kind, purpose, binding, rp_id, expires_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(challenge, kind, purpose, binding, rpID, now() + CHALLENGE_MS);
  getDb()
    .prepare(`DELETE FROM presence_challenges WHERE expires_at < ?`)
    .run(now() - 60 * 60 * 1000);
}

// Spends the challenge if it was issued for exactly this; throws if not.
function takeChallenge(
  challenge: string,
  kind: "register" | "assert",
  purpose: string,
  binding: string,
  rpID: string
): void {
  const taken = getDb()
    .prepare(
      `UPDATE presence_challenges SET used_at = ?
       WHERE challenge = ? AND kind = ? AND purpose = ? AND binding = ? AND rp_id = ?
         AND used_at IS NULL AND expires_at > ?`
    )
    .run(now(), challenge, kind, purpose, binding, rpID, now()).changes;
  if (taken !== 1)
    throw new PresenceError(
      "That confirmation is for something else, expired or already used. Try again."
    );
}

function challengeOf(response: { response: { clientDataJSON: string } }) {
  try {
    const data = JSON.parse(
      Buffer.from(response.response.clientDataJSON, "base64url").toString()
    ) as { challenge?: unknown };
    if (typeof data.challenge === "string") return data.challenge;
  } catch {}
  throw new PresenceError("Malformed passkey response");
}

const transportsOf = (k: PasskeyRow) =>
  k.transports
    ? (JSON.parse(k.transports) as AuthenticatorTransport[])
    : undefined;
type AuthenticatorTransport =
  | "ble"
  | "cable"
  | "hybrid"
  | "internal"
  | "nfc"
  | "smart-card"
  | "usb";

// Options for an assertion on this host, or null when it has no passkey.
export async function assertionOptions(
  rp: RelyingParty,
  purpose: PresencePurpose,
  binding: string
): Promise<PublicKeyCredentialRequestOptionsJSON | null> {
  const keys = activePasskeys(rp.rpID);
  if (!keys.length) return null;
  const options = await generateAuthenticationOptions({
    rpID: rp.rpID,
    allowCredentials: keys.map((k) => ({
      id: k.id,
      transports: transportsOf(k),
    })),
    userVerification: "required",
    timeout: CHALLENGE_MS,
  });
  storeChallenge(options.challenge, "assert", purpose, binding, rp.rpID);
  return options;
}

// Checks the assertion was made for exactly this, with user verification,
// by an active passkey of this host. Returns the passkey.
export async function verifyPresence(
  rp: RelyingParty,
  response: AuthenticationResponseJSON | null | undefined,
  purpose: PresencePurpose,
  binding: string
): Promise<PasskeyRow> {
  if (!response?.response?.clientDataJSON)
    throw new PresenceError("This needs your passkey (Touch ID or Face ID)");
  const challenge = challengeOf(response);
  const key = getPasskey(response.id);
  if (!key || key.revoked_at || key.rp_id !== rp.rpID)
    throw new PresenceError("Unknown passkey");
  // Spent before the signature is checked: one try per challenge.
  takeChallenge(challenge, "assert", purpose, binding, rp.rpID);
  const result = await verifyAuthenticationResponse({
    response,
    expectedChallenge: challenge,
    expectedOrigin: rp.origin,
    expectedRPID: rp.rpID,
    credential: {
      id: key.id,
      publicKey: new Uint8Array(key.public_key),
      counter: key.counter,
      transports: transportsOf(key),
    },
    requireUserVerification: true,
  }).catch((error: unknown) => {
    throw new PresenceError(
      error instanceof Error ? error.message : "Passkey check failed"
    );
  });
  if (!result.verified || !result.authenticationInfo.userVerified)
    throw new PresenceError("Passkey check failed");
  touchPasskey(key.id, result.authenticationInfo.newCounter);
  return key;
}

const hash = (code: string) =>
  crypto.createHash("sha256").update(code.trim().toUpperCase()).digest("hex");

// A one-time code for adding a passkey on another device, after an
// assertion from an existing one.
export function mintEnrollCode(): string {
  const code = crypto.randomBytes(5).toString("hex").toUpperCase();
  getDb()
    .prepare(
      `INSERT INTO passkey_enrollments (code_hash, expires_at) VALUES (?, ?)`
    )
    .run(hash(code), now() + ENROLL_MS);
  return code;
}

function enrollmentValid(code: string): boolean {
  return !!getDb()
    .prepare(
      `SELECT 1 FROM passkey_enrollments WHERE code_hash = ? AND used_at IS NULL AND expires_at > ?`
    )
    .get(hash(code), now());
}

function registrationBinding(enrollCode?: string): string {
  if (!passkeysBootstrapped()) return "bootstrap";
  if (!enrollCode || !enrollmentValid(enrollCode))
    throw new PresenceError(
      "Adding a passkey needs a code from a device that already has one (Devices > Passkeys). With none left, run `agent-os passkeys reset` on the machine.",
      "enroll"
    );
  return `enroll:${hash(enrollCode)}`;
}

export async function registrationOptions(
  rp: RelyingParty,
  enrollCode?: string
): Promise<PublicKeyCredentialCreationOptionsJSON> {
  const binding = registrationBinding(enrollCode);
  const options = await generateRegistrationOptions({
    rpName: "AgentOS",
    rpID: rp.rpID,
    userName: "agentos",
    userDisplayName: "AgentOS approvals",
    userID: new TextEncoder().encode("agentos-owner"),
    attestationType: "none",
    excludeCredentials: activePasskeys(rp.rpID).map((k) => ({
      id: k.id,
      transports: transportsOf(k),
    })),
    authenticatorSelection: {
      residentKey: "preferred",
      userVerification: "required",
    },
    timeout: CHALLENGE_MS,
  });
  storeChallenge(options.challenge, "register", "register", binding, rp.rpID);
  return options;
}

export async function verifyRegistration(
  rp: RelyingParty,
  response: RegistrationResponseJSON,
  meta: {
    name: string;
    via: string;
    from: string | null;
    userAgent: string | null;
  },
  enrollCode?: string
): Promise<PasskeyRow> {
  const challenge = challengeOf(response);
  const binding = registrationBinding(enrollCode);
  const result = await verifyRegistrationResponse({
    response,
    expectedChallenge: challenge,
    expectedOrigin: rp.origin,
    expectedRPID: rp.rpID,
    requireUserVerification: true,
  }).catch((error: unknown) => {
    throw new PresenceError(
      error instanceof Error ? error.message : "Passkey registration failed"
    );
  });
  if (!result.verified) throw new PresenceError("Passkey registration failed");
  return getDb().transaction(() => {
    takeChallenge(challenge, "register", "register", binding, rp.rpID);
    if (binding === "bootstrap") {
      if (passkeysBootstrapped())
        throw new PresenceError(
          "A passkey was added meanwhile; get a code from it"
        );
      markBootstrapped();
    }
    if (binding !== "bootstrap") {
      const used = getDb()
        .prepare(
          `UPDATE passkey_enrollments SET used_at = ? WHERE code_hash = ? AND used_at IS NULL`
        )
        .run(now(), hash(enrollCode!)).changes;
      if (used !== 1) throw new PresenceError("That code was already used");
    }
    const c = result.registrationInfo.credential;
    return addPasskey({
      id: c.id,
      publicKey: c.publicKey,
      counter: c.counter,
      transports: c.transports,
      rpId: rp.rpID,
      ...meta,
    });
  })();
}
