import { NextRequest, NextResponse } from "next/server";
import { requireApprover } from "@/lib/security/approver";
import { peerAudit } from "@/lib/peer/audit";

// GET /api/peers/:hostId/audit - every call to and from that linked machine,
// newest first: Machines → Activity.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ hostId: string }> }
) {
  const gate = requireApprover(request);
  if (!gate.ok) return gate.response;
  return NextResponse.json({ rows: peerAudit((await params).hostId) });
}
