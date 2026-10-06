import { NextRequest, NextResponse } from "next/server";
import type { AuthenticationResponseJSON } from "@simplewebauthn/server";
import { requireApprover } from "@/lib/security/approver";
import {
  activePasskeyCount,
  getPasskey,
  revokePasskey,
} from "@/lib/security/passkeys";
import { relyingParty, verifyPresence } from "@/lib/security/presence";
import { refusalResponse } from "@/lib/security/presence-http";
import { revokePresence } from "@/lib/orchestrator/presence-binding";
import { resolvePasskeyAsks } from "@/lib/orchestrator/asks";

type Ctx = { params: Promise<{ id: string }> };

// Revoking needs a passkey assertion, unless it's the only one left and
// the request comes from this machine (so a lost passkey isn't a lockout).
export async function DELETE(request: NextRequest, { params }: Ctx) {
  const gate = requireApprover(request);
  if (!gate.ok) return gate.response;
  const { id } = await params;
  try {
    const key = getPasskey(id);
    if (!key || key.revoked_at)
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    const lastOnThisMachine =
      activePasskeyCount() === 1 && gate.approver.via === "loopback";
    if (!lastOnThisMachine) {
      const { assertion } = (await request.json().catch(() => ({}))) as {
        assertion?: AuthenticationResponseJSON;
      };
      await verifyPresence(
        relyingParty(request.headers),
        assertion,
        "revoke",
        revokePresence(id)
      );
    }
    revokePasskey(id);
    resolvePasskeyAsks(id, "revoked");
    return NextResponse.json({ ok: true });
  } catch (error) {
    return refusalResponse(error);
  }
}
