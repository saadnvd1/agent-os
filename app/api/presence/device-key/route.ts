import { NextRequest, NextResponse } from "next/server";
import { requireApprover } from "@/lib/security/approver";
import { verifyDeviceRegistration } from "@/lib/security/presence";
import { placeOf, refusalResponse } from "@/lib/security/presence-http";
import { raisePasskeyAsks } from "@/lib/orchestrator/passkey-asks";
import { resolvePasskeyAsks } from "@/lib/orchestrator/asks";

// Stores the paired device's own approval key, and puts it on Saad's asks
// list to confirm. A key it replaces (a reinstall) is revoked and noted.
export async function POST(request: NextRequest) {
  const gate = requireApprover(request);
  if (!gate.ok) return gate.response;
  if (gate.approver.via !== "device" || !gate.approver.deviceId)
    return NextResponse.json(
      { error: "Only a paired device has its own key" },
      { status: 403 }
    );
  try {
    const body = (await request.json().catch(() => ({}))) as {
      publicKey?: string;
      challenge?: string;
      signature?: string;
      name?: string;
      hardware?: string;
      enrollCode?: string;
    };
    if (!body.publicKey || !body.challenge || !body.signature)
      return NextResponse.json({ error: "No key" }, { status: 400 });
    const place = placeOf(gate.approver, request.headers);
    const { key, replaced } = verifyDeviceRegistration(
      gate.approver.deviceId,
      {
        publicKey: body.publicKey,
        challenge: body.challenge,
        signature: body.signature,
        name: body.name || place,
        hardware: body.hardware,
      },
      {
        via: gate.approver.via,
        from: place,
        userAgent: request.headers.get("user-agent"),
      },
      body.enrollCode
    );
    for (const old of replaced) {
      resolvePasskeyAsks(old.id, "replaced");
      raisePasskeyAsks(old, place, "revoked");
    }
    raisePasskeyAsks(key, place);
    return NextResponse.json({ passkey: { id: key.id, name: key.name } });
  } catch (error) {
    return refusalResponse(error);
  }
}
