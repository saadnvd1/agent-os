import { NextRequest, NextResponse } from "next/server";
import type { RegistrationResponseJSON } from "@simplewebauthn/server";
import { requireApprover } from "@/lib/security/approver";
import { relyingParty, verifyRegistration } from "@/lib/security/presence";
import { placeOf, refusalResponse } from "@/lib/security/presence-http";
import { raisePasskeyAsks } from "@/lib/orchestrator/passkey-asks";

// Stores a new passkey, and puts it on Saad's asks list to confirm.
export async function POST(request: NextRequest) {
  const gate = requireApprover(request);
  if (!gate.ok) return gate.response;
  try {
    const body = (await request.json().catch(() => ({}))) as {
      response?: RegistrationResponseJSON;
      name?: string;
      enrollCode?: string;
    };
    if (!body.response)
      return NextResponse.json({ error: "No passkey" }, { status: 400 });
    const place = placeOf(gate.approver, request.headers);
    const key = await verifyRegistration(
      relyingParty(request.headers),
      body.response,
      {
        name: body.name || place,
        via: gate.approver.via,
        from: place,
        userAgent: request.headers.get("user-agent"),
      },
      body.enrollCode
    );
    raisePasskeyAsks(key, place);
    return NextResponse.json({ passkey: { id: key.id, name: key.name } });
  } catch (error) {
    return refusalResponse(error);
  }
}
