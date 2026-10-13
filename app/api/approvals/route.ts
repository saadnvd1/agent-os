import { NextRequest, NextResponse } from "next/server";
import type { AuthenticationResponseJSON } from "@simplewebauthn/server";
import { switchNoApprovals } from "@/lib/approvals/enable";
import { listAutoApprovals, noApprovalsOn } from "@/lib/approvals/no-approvals";
import { NO_APPROVALS_ON_PRESENCE } from "@/lib/orchestrator/presence-binding";
import { requireApprover } from "@/lib/security/approver";
import { relyingParty, verifyPresence } from "@/lib/security/presence";
import { refusalResponse } from "@/lib/security/presence-http";
import { requireLocalTrust } from "@/lib/security/route-guard";

const view = () => ({ on: noApprovalsOn(), audit: listAutoApprovals(20) });

// GET /api/approvals - whether No approvals mode is on, and its latest audit lines
export function GET() {
  return NextResponse.json(view());
}

// PUT /api/approvals {on, assertion?} - turning it on is deliberate: only
// this machine or the tailnet, and with Saad's passkey, since it switches
// off every approval. Turning it off only needs a place that may approve.
export async function PUT(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as {
    on?: unknown;
    assertion?: AuthenticationResponseJSON;
  };
  if (typeof body.on !== "boolean")
    return NextResponse.json(
      { error: "on must be true or false" },
      { status: 400 }
    );
  if (body.on) {
    const refused = requireLocalTrust(request);
    if (refused) return refused;
    if (!noApprovalsOn()) {
      try {
        await verifyPresence(
          relyingParty(request.headers),
          body.assertion,
          "no-approvals-on",
          NO_APPROVALS_ON_PRESENCE
        );
      } catch (error) {
        return refusalResponse(error);
      }
    }
  } else {
    const gate = requireApprover(request);
    if (!gate.ok) return gate.response;
  }
  await switchNoApprovals(body.on);
  return NextResponse.json(view());
}
