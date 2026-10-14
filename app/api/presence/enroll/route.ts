import { NextRequest, NextResponse } from "next/server";
import { requireApprover } from "@/lib/security/approver";
import { mintEnrollCode } from "@/lib/security/presence";
import {
  refusalResponse,
  requirePresence,
  type PresenceProof,
} from "@/lib/security/presence-http";

// A one-time code (10 minutes) for adding a passkey on another device,
// minted only on an assertion from an existing passkey.
export async function POST(request: NextRequest) {
  const gate = requireApprover(request);
  if (!gate.ok) return gate.response;
  try {
    const body = (await request.json().catch(() => ({}))) as PresenceProof;
    await requirePresence(request, gate.approver, body, "enroll", "enroll");
    return NextResponse.json({ code: mintEnrollCode() });
  } catch (error) {
    return refusalResponse(error);
  }
}
