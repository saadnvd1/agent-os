import { NextRequest, NextResponse } from "next/server";
import { requireApprover } from "@/lib/security/approver";
import { registrationOptions, relyingParty } from "@/lib/security/presence";
import { refusalResponse } from "@/lib/security/presence-http";

// Options to add a passkey on this browser: free for the very first one,
// otherwise with an enrollment code from a device that has one.
export async function POST(request: NextRequest) {
  const gate = requireApprover(request);
  if (!gate.ok) return gate.response;
  try {
    const { enrollCode } = (await request.json().catch(() => ({}))) as {
      enrollCode?: string;
    };
    const options = await registrationOptions(
      relyingParty(request.headers),
      enrollCode
    );
    return NextResponse.json({ options });
  } catch (error) {
    return refusalResponse(error);
  }
}
