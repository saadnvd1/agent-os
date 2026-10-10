import { NextRequest, NextResponse } from "next/server";
import { mirrorPeerSession } from "@/lib/hosts/peer-mirror";

// POST /api/hosts/:id/sessions {sessionId} - open a session that machine's
// own AgentOS runs: mirrored here, so it opens like any other.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { sessionId } = await request.json().catch(() => ({}));
    if (typeof sessionId !== "string" || !sessionId)
      return NextResponse.json(
        { error: "sessionId is required" },
        { status: 400 }
      );
    const session = await mirrorPeerSession((await params).id, sessionId);
    return NextResponse.json({ session });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
