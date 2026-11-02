import type { NextRequest } from "next/server";
import { requireApprover } from "@/lib/security/approver";
import {
  refusalResponse,
  requirePresence,
  type PresenceProof,
} from "@/lib/security/presence-http";
import { rulesPresence } from "@/lib/orchestrator/presence-binding";

// A rule written here is Saad's, shown to the orchestrator as his word and
// removable only by him: so it takes his passkey, not just a trusted place
// (any process on this machine reaches the route).
export async function provenAsOwner(
  request: NextRequest,
  workspaceId: string,
  proof: PresenceProof | undefined
): Promise<Response | null> {
  const gate = requireApprover(request);
  if (!gate.ok) return gate.response;
  try {
    await requirePresence(
      request,
      gate.approver,
      proof,
      "rules",
      rulesPresence(workspaceId)
    );
    return null;
  } catch (error) {
    return refusalResponse(error);
  }
}
