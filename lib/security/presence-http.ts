// Shared by the routes that need a person: what to call the place a request
// came from, and how a refusal reads.

import { NextResponse } from "next/server";
import { REMOTE_HEADER } from "./auth";
import type { Approver } from "./approver";
import { getDevice } from "./devices";
import type { AuthenticationResponseJSON } from "@simplewebauthn/server";
import type { NextRequest } from "next/server";
import type { PasskeyRow } from "./passkeys";
import {
  PresenceError,
  relyingParty,
  verifyDevicePresence,
  verifyPresence,
  type DeviceSignature,
  type PresencePurpose,
} from "./presence";

export function placeOf(approver: Approver, headers: Headers): string {
  if (approver.via === "loopback") return "this machine";
  if (approver.via === "tailnet")
    return `the tailnet (${headers.get(REMOTE_HEADER) ?? "unknown address"})`;
  return getDevice(approver.deviceId ?? "")?.name ?? "a paired device";
}

// What a request sends to prove a person: a browser's passkey assertion, or
// a paired device's signature from its own key.
export interface PresenceProof {
  assertion?: AuthenticationResponseJSON;
  deviceSignature?: DeviceSignature;
}

// A device signature counts only from the device whose key it is; anything
// else goes through the browser passkey check as before.
export function requirePresence(
  request: NextRequest,
  approver: Approver,
  proof: PresenceProof | null | undefined,
  purpose: PresencePurpose,
  binding: string
): Promise<PasskeyRow> {
  if (proof?.deviceSignature) {
    if (approver.via !== "device" || !approver.deviceId)
      return Promise.reject(
        new PresenceError("Only a paired device can sign with its own key")
      );
    return Promise.resolve().then(() =>
      verifyDevicePresence(
        approver.deviceId!,
        proof.deviceSignature,
        purpose,
        binding
      )
    );
  }
  return verifyPresence(
    relyingParty(request.headers),
    proof?.assertion,
    purpose,
    binding
  );
}

export function refusalResponse(error: unknown): NextResponse {
  if (error instanceof PresenceError)
    return NextResponse.json(
      { error: error.message, code: error.code },
      { status: error.code === "insecure" ? 400 : 403 }
    );
  const message = error instanceof Error ? error.message : String(error);
  return NextResponse.json({ error: message }, { status: 409 });
}
