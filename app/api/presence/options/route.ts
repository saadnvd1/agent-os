import { NextRequest, NextResponse } from "next/server";
import { requireApprover } from "@/lib/security/approver";
import {
  assertionOptions,
  deviceAssertionOptions,
  relyingParty,
  type PresencePurpose,
} from "@/lib/security/presence";
import { passkeysBootstrapped } from "@/lib/security/passkeys";
import { refusalResponse } from "@/lib/security/presence-http";
import { presenceBinding } from "@/lib/orchestrator/presence-binding";

// Options for a passkey assertion bound to one thing: an ask (at the commit
// or brake it's about), a Resume, minting an enrollment code, a revoke.
export async function POST(request: NextRequest) {
  const gate = requireApprover(request);
  if (!gate.ok) return gate.response;
  try {
    const body = (await request.json().catch(() => ({}))) as {
      purpose?: PresencePurpose;
      workspaceId?: string;
      askId?: number;
      binding?: string;
      passkeyId?: string;
      method?: "device";
    };
    const binding = presenceBinding(body);
    if (body.method === "device") {
      if (gate.approver.via !== "device" || !gate.approver.deviceId)
        return NextResponse.json(
          { error: "Only a paired device has its own key" },
          { status: 403 }
        );
      const device = deviceAssertionOptions(
        gate.approver.deviceId,
        body.purpose!,
        binding
      );
      if (!device)
        return NextResponse.json({
          needsDeviceKey: true,
          canBootstrap: !passkeysBootstrapped(),
        });
      return NextResponse.json({ device });
    }
    const rp = relyingParty(request.headers);
    const options = await assertionOptions(rp, body.purpose!, binding);
    if (!options)
      return NextResponse.json({
        needsPasskey: true,
        canBootstrap: !passkeysBootstrapped(),
      });
    return NextResponse.json({ options });
  } catch (error) {
    return refusalResponse(error);
  }
}
