import { NextRequest, NextResponse } from "next/server";
import { requireApprover } from "@/lib/security/approver";
import { declineRequest } from "@/lib/peer/pairing";

// POST /api/peers/pending/:id/decline
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = requireApprover(request);
  if (!gate.ok) return gate.response;
  return NextResponse.json({ declined: declineRequest((await params).id) });
}
