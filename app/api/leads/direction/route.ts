import { NextRequest, NextResponse } from "next/server";
import { requireApprover } from "@/lib/security/approver";
import {
  applyDirection,
  directionView,
  parseDirectionAction,
} from "@/lib/leads/direction-view";

// A lead chat's direction: pins in force, history, the lead's proposals and
// memo. `direction: null` for a chat that has none.
export async function GET(request: NextRequest) {
  const sessionId = request.nextUrl.searchParams.get("sessionId") ?? "";
  return NextResponse.json({ direction: directionView(sessionId) });
}

// The owner pins one of his messages, takes a pin down, or answers one of
// the lead's proposals.
export async function POST(request: NextRequest) {
  const gate = requireApprover(request);
  if (!gate.ok) return gate.response;
  const body = (await request.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;
  const sessionId = typeof body.sessionId === "string" ? body.sessionId : "";
  const action = parseDirectionAction(body);
  if (!action)
    return NextResponse.json(
      {
        error: "Send pin (itemId), unpin (pinId) or proposal (proposalId, pin)",
      },
      { status: 400 }
    );
  const refused = applyDirection(sessionId, action);
  if (refused) return NextResponse.json(refused, { status: 400 });
  return NextResponse.json({ direction: directionView(sessionId) });
}
