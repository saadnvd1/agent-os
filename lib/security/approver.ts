/**
 * Who may answer the orchestrator's asks or pause it: this machine, the
 * tailnet, or a paired device Saad has let approve (off by default). This
 * is the coarse gate; approvals that matter also need a passkey (presence).
 */

import { NextResponse, type NextRequest } from "next/server";
import { DEVICE_HEADER, TRUST_HEADER } from "./auth";
import { getDevice } from "./devices";

export interface Approver {
  via: "loopback" | "tailnet" | "device";
  deviceId: string | null;
}

export function approverOf(headers: Headers): Approver | null {
  const via = headers.get(TRUST_HEADER);
  if (via === "loopback" || via === "tailnet") return { via, deviceId: null };
  if (via !== "device") return null;
  const id = headers.get(DEVICE_HEADER);
  const device = id ? getDevice(id) : null;
  return device && !device.revoked_at && device.can_approve
    ? { via, deviceId: device.id }
    : null;
}

export function requireApprover(
  request: NextRequest
): { ok: true; approver: Approver } | { ok: false; response: NextResponse } {
  const approver = approverOf(request.headers);
  if (approver) return { ok: true, approver };
  return {
    ok: false,
    response: NextResponse.json(
      {
        error:
          'This device can\'t answer asks. Turn on "Can approve" for it in Devices, from this Mac or over Tailscale.',
      },
      { status: 403 }
    ),
  };
}
