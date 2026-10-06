// Shared by the routes that need a person: what to call the place a request
// came from, and how a refusal reads.

import { NextResponse } from "next/server";
import { REMOTE_HEADER } from "./auth";
import type { Approver } from "./approver";
import { getDevice } from "./devices";
import { PresenceError } from "./presence";

export function placeOf(approver: Approver, headers: Headers): string {
  if (approver.via === "loopback") return "this machine";
  if (approver.via === "tailnet")
    return `the tailnet (${headers.get(REMOTE_HEADER) ?? "unknown address"})`;
  return getDevice(approver.deviceId ?? "")?.name ?? "a paired device";
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
