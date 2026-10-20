import { NextRequest, NextResponse } from "next/server";
import { requireApprover } from "@/lib/security/approver";
import { cancelLink, outgoingLink } from "@/lib/peer/pairing-out";

type Ctx = { params: Promise<{ id: string }> };

// GET /api/peers/link/:id - a link this machine started: its code and state.
export async function GET(_request: NextRequest, { params }: Ctx) {
  const link = outgoingLink((await params).id);
  if (!link)
    return NextResponse.json({ error: "No such request" }, { status: 404 });
  return NextResponse.json({ link });
}

// DELETE /api/peers/link/:id - stop waiting for it.
export async function DELETE(request: NextRequest, { params }: Ctx) {
  const gate = requireApprover(request);
  if (!gate.ok) return gate.response;
  return NextResponse.json({ cancelled: cancelLink((await params).id) });
}
