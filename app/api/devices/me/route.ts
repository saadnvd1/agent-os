import { NextRequest, NextResponse } from "next/server";
import { revokeDevice } from "@/lib/security/devices";
import { callingDevice, needsDevice } from "@/lib/security/device-me";

// DELETE /api/devices/me - the device signs itself out ("Forget machine")
export async function DELETE(request: NextRequest) {
  const id = callingDevice(request);
  if (!id) return needsDevice();
  if (!revokeDevice(id))
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
