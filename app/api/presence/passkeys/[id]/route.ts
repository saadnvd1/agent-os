import { NextRequest, NextResponse } from "next/server";
import type { AuthenticationResponseJSON } from "@simplewebauthn/server";
import { requireApprover } from "@/lib/security/approver";
import { getPasskey, revokePasskey } from "@/lib/security/passkeys";
import { relyingParty, verifyPresence } from "@/lib/security/presence";
import { placeOf, refusalResponse } from "@/lib/security/presence-http";
import { raisePasskeyAsks } from "@/lib/orchestrator/passkey-asks";
import { revokePresence } from "@/lib/orchestrator/presence-binding";
import { resolvePasskeyAsks } from "@/lib/orchestrator/asks";

type Ctx = { params: Promise<{ id: string }> };

// Revoking always needs a passkey assertion, the last one included: an
// empty list never re-opens trust-on-first-use, so a revoke can't be used
// to make way for someone else's passkey. It goes on the asks list too.
export async function DELETE(request: NextRequest, { params }: Ctx) {
  const gate = requireApprover(request);
  if (!gate.ok) return gate.response;
  const { id } = await params;
  try {
    const key = getPasskey(id);
    if (!key || key.revoked_at)
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    const { assertion } = (await request.json().catch(() => ({}))) as {
      assertion?: AuthenticationResponseJSON;
    };
    await verifyPresence(
      relyingParty(request.headers),
      assertion,
      "revoke",
      revokePresence(id)
    );
    revokePasskey(id);
    resolvePasskeyAsks(id, "revoked");
    raisePasskeyAsks(key, placeOf(gate.approver, request.headers), "revoked");
    return NextResponse.json({ ok: true });
  } catch (error) {
    return refusalResponse(error);
  }
}
