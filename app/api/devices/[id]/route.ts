import { NextRequest, NextResponse } from "next/server";
import {
  renameDevice,
  revokeDevice,
  setDeviceCanApprove,
} from "@/lib/security/devices";
import { requireLocalTrust } from "@/lib/security/route-guard";
import { DEVICE_HEADER } from "@/lib/security/auth";
import { demoMode } from "@/lib/security/demo";

type Ctx = { params: Promise<{ id: string }> };

// PATCH /api/devices/:id - rename, or let it answer asks (only from this
// machine or the tailnet, never from a device token)
export async function PATCH(request: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const { name, canApprove } = (await request.json().catch(() => ({}))) as {
    name?: string;
    canApprove?: boolean;
  };
  if (typeof canApprove === "boolean") {
    const refused = requireLocalTrust(request);
    if (refused) return refused;
    if (!setDeviceCanApprove(id, canApprove))
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  }
  if (!name || !renameDevice(id, name)) {
    return NextResponse.json(
      { error: "Not found or empty name" },
      { status: 400 }
    );
  }
  return NextResponse.json({ ok: true });
}

// DELETE /api/devices/:id - revoke; its open terminals drop at once
export async function DELETE(request: NextRequest, { params }: Ctx) {
  const { id } = await params;
  // In a demo a visitor may sign only their own device out.
  if (demoMode() && request.headers.get(DEVICE_HEADER) !== id)
    return NextResponse.json(
      { error: "Not available in the demo." },
      { status: 403 }
    );
  if (!revokeDevice(id))
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
