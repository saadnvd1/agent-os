import { NextRequest, NextResponse } from "next/server";
import { requireApprover } from "@/lib/security/approver";
import {
  assertionOptions,
  relyingParty,
  type PresencePurpose,
} from "@/lib/security/presence";
import { activePasskeyCount } from "@/lib/security/passkeys";
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
    };
    const binding = presenceBinding(body);
    const rp = relyingParty(request.headers);
    const options = await assertionOptions(rp, body.purpose!, binding);
    if (!options)
      return NextResponse.json({
        needsPasskey: true,
        canBootstrap: activePasskeyCount() === 0,
      });
    return NextResponse.json({ options });
  } catch (error) {
    return refusalResponse(error);
  }
}
