import type { NextRequest } from "next/server";
import type { AuthenticationResponseJSON } from "@simplewebauthn/server";
import { requireApprover } from "@/lib/security/approver";
import { relyingParty, verifyPresence } from "@/lib/security/presence";
import { refusalResponse } from "@/lib/security/presence-http";
import { rulesPresence } from "@/lib/orchestrator/presence-binding";

// A rule written here is Saad's, shown to the orchestrator as his word and
// removable only by him: so it takes his passkey, not just a trusted place
// (any process on this machine reaches the route).
export async function provenAsSaad(
  request: NextRequest,
  workspaceId: string,
  assertion: AuthenticationResponseJSON | undefined
): Promise<Response | null> {
  const gate = requireApprover(request);
  if (!gate.ok) return gate.response;
  try {
    await verifyPresence(
      relyingParty(request.headers),
      assertion,
      "rules",
      rulesPresence(workspaceId)
    );
    return null;
  } catch (error) {
    return refusalResponse(error);
  }
}
