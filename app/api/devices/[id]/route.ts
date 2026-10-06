import { NextRequest, NextResponse } from "next/server";
import { renameDevice, revokeDevice } from "@/lib/security/devices";

type Ctx = { params: Promise<{ id: string }> };

// PATCH /api/devices/:id - rename
export async function PATCH(request: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const { name } = (await request.json().catch(() => ({}))) as {
    name?: string;
  };
  if (!name || !renameDevice(id, name)) {
    return NextResponse.json(
      { error: "Not found or empty name" },
      { status: 400 }
    );
  }
  return NextResponse.json({ ok: true });
}

// DELETE /api/devices/:id - revoke; its open terminals drop at once
export async function DELETE(_: NextRequest, { params }: Ctx) {
  const { id } = await params;
  if (!revokeDevice(id))
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
