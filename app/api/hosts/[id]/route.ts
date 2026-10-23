import { NextRequest, NextResponse } from "next/server";
import { deleteHost, renameHost } from "@/lib/hosts";
import { requireLocalTrust } from "@/lib/security/route-guard";
import { pinForHost } from "@/lib/peer/links";

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const id = (await params).id;
    // Removing it here would leave the other machine linked to this one.
    if (pinForHost(id))
      return NextResponse.json(
        { error: "It's linked through Connect: unlink it first." },
        { status: 409 }
      );
    deleteHost(id);
    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

// Rename a machine; "local" is this one, and its name is the one Work across
// machines shows too.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = requireLocalTrust(request);
  if (denied) return denied;
  try {
    const id = (await params).id;
    const body = (await request.json().catch(() => null)) as {
      name?: unknown;
    } | null;
    return NextResponse.json({
      name: renameHost(id, String(body?.name ?? "")),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
