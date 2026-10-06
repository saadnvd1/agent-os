import { NextRequest, NextResponse } from "next/server";
import type { AuthenticationResponseJSON } from "@simplewebauthn/server";
import { requireApprover } from "@/lib/security/approver";
import {
  mintEnrollCode,
  relyingParty,
  verifyPresence,
} from "@/lib/security/presence";
import { refusalResponse } from "@/lib/security/presence-http";

// A one-time code (10 minutes) for adding a passkey on another device,
// minted only on an assertion from an existing passkey.
export async function POST(request: NextRequest) {
  const gate = requireApprover(request);
  if (!gate.ok) return gate.response;
  try {
    const { assertion } = (await request.json().catch(() => ({}))) as {
      assertion?: AuthenticationResponseJSON;
    };
    await verifyPresence(
      relyingParty(request.headers),
      assertion,
      "enroll",
      "enroll"
    );
    return NextResponse.json({ code: mintEnrollCode() });
  } catch (error) {
    return refusalResponse(error);
  }
}
