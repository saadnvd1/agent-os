import { NextRequest, NextResponse } from "next/server";
import { requireApprover } from "@/lib/security/approver";
import {
  deviceRegistrationOptions,
  PresenceError,
} from "@/lib/security/presence";
import { refusalResponse } from "@/lib/security/presence-http";
import { passkeysBootstrapped } from "@/lib/security/passkeys";

// A challenge for this paired device's new approval key to sign. The key is
// the device's own, so only a paired device asks; with passkeys already set
// up, it needs a code from one of them, like a browser passkey does.
export async function POST(request: NextRequest) {
  const gate = requireApprover(request);
  if (!gate.ok) return gate.response;
  if (gate.approver.via !== "device" || !gate.approver.deviceId)
    return NextResponse.json(
      { error: "Only a paired device has its own key" },
      { status: 403 }
    );
  try {
    const { enrollCode } = (await request.json().catch(() => ({}))) as {
      enrollCode?: string;
    };
    return NextResponse.json(
      deviceRegistrationOptions(gate.approver.deviceId, enrollCode)
    );
  } catch (error) {
    if (error instanceof PresenceError && error.code === "enroll")
      return NextResponse.json({
        needsCode: true,
        canBootstrap: !passkeysBootstrapped(),
      });
    return refusalResponse(error);
  }
}
