import { NextRequest, NextResponse } from "next/server";
import { revokeDeviceAndKeys } from "@/lib/orchestrator/passkey-asks";
import { callingDevice, needsDevice } from "@/lib/security/device-me";

// DELETE /api/devices/me - the device signs itself out ("Forget machine")
export async function DELETE(request: NextRequest) {
  const id = callingDevice(request);
  if (!id) return needsDevice();
  if (!revokeDeviceAndKeys(id, "the device itself"))
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
