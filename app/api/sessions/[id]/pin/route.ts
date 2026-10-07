import { NextResponse } from "next/server";
import { setPinned } from "@/lib/sidebar/pin";

// POST /api/sessions/:id/pin { pinned } - put it on the sidebar's Pinned shelf.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = (await request.json().catch(() => null)) as {
    pinned?: unknown;
  } | null;
  if (typeof body?.pinned !== "boolean")
    return NextResponse.json(
      { error: "pinned must be a boolean" },
      { status: 400 }
    );
  if (!setPinned(id, body.pinned))
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
