import { NextRequest, NextResponse } from "next/server";
import { experimentOn } from "@/lib/experiments";
import { requireApprover } from "@/lib/security/approver";
import { getWorkspace } from "@/lib/workspaces";
import { adoptLead } from "@/lib/leads/adopt";

// Adopt an existing chat as one of a workspace's leads. It keeps its id,
// its chat and its conversation; see lib/leads/adopt.
export async function POST(request: NextRequest) {
  const gate = requireApprover(request);
  if (!gate.ok) return gate.response;
  if (!experimentOn("leads"))
    return NextResponse.json(
      { error: "Leads is off (Settings → Experiments)" },
      { status: 409 }
    );
  const body = await request.json().catch(() => ({}));
  const { sessionId, workspaceId, kind } = body as Record<string, unknown>;
  if (typeof sessionId !== "string" || typeof kind !== "string")
    return NextResponse.json(
      { error: "Give sessionId, workspaceId and kind" },
      { status: 400 }
    );
  if (typeof workspaceId !== "string" || !getWorkspace(workspaceId))
    return NextResponse.json({ error: "Unknown workspace" }, { status: 404 });
  try {
    const session = await adoptLead({ sessionId, workspaceId, kind });
    return NextResponse.json({ session });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 400 }
    );
  }
}
