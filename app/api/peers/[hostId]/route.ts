import { NextRequest, NextResponse } from "next/server";
import { requireApprover } from "@/lib/security/approver";
import { unlinkPeer } from "@/lib/peer/unlink";

// DELETE /api/peers/:hostId - unlink a machine linked through Connect: its
// pin goes here at once, and it's told to drop its side. Takes the same
// trust as linking.
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ hostId: string }> }
) {
  const gate = requireApprover(request);
  if (!gate.ok) return gate.response;
  try {
    return NextResponse.json(await unlinkPeer((await params).hostId));
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error }, { status: 404 });
  }
}
