/**
 * The one refusal that is signed: "unknown peer", sent to a machine that was
 * unlinked here, bound to its own request's nonce. Only the key it had pinned
 * for this machine verifies it, so whoever carries the traffic can't forge an
 * unlink, and a replayed one never matches a new request.
 */

import crypto, { type KeyObject } from "crypto";

export const UNLINKED_PROOF_HEADER = "x-agentos-peer-unlinked";
const DOMAIN = "agentos-peer-unlinked-v1";

interface Bound {
  /** The machine refusing: the one that unlinked. */
  from: string;
  /** The caller, which it no longer knows. */
  to: string;
  /** The caller's request nonce, base64url. */
  nonce: string;
}

const message = (o: Bound) =>
  Buffer.from(`${DOMAIN}|${o.from}|${o.to}|${o.nonce}`);

export const signUnlinked = (signKey: KeyObject, o: Bound): string =>
  crypto.sign(null, message(o), signKey).toString("base64url");

export function verifyUnlinked(
  signPub: KeyObject,
  o: Bound,
  sig: string | null
): boolean {
  if (!sig || !/^[A-Za-z0-9_-]{86}$/.test(sig)) return false;
  try {
    return crypto.verify(
      null,
      message(o),
      signPub,
      Buffer.from(sig, "base64url")
    );
  } catch {
    return false;
  }
}
