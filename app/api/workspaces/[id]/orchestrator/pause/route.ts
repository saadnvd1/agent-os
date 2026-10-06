import { NextRequest, NextResponse } from "next/server";
import type { AuthenticationResponseJSON } from "@simplewebauthn/server";
import { getWorkspace } from "@/lib/workspaces";
import { setPaused } from "@/lib/orchestrator/pause";
import { requireApprover } from "@/lib/security/approver";
import { relyingParty, verifyPresence } from "@/lib/security/presence";
import { refusalResponse } from "@/lib/security/presence-http";
import { resumePresence } from "@/lib/orchestrator/presence-binding";

type RouteParams = { params: Promise<{ id: string }> };

// Pause or resume the workspace's orchestrator: { paused: boolean }. Pausing
// only needs a trusted place; resuming lets it act again, so it needs
// Saad's passkey too.
export async function POST(request: NextRequest, { params }: RouteParams) {
  const gate = requireApprover(request);
  if (!gate.ok) return gate.response;
  const { id } = await params;
  if (!getWorkspace(id))
    return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
  const { paused, assertion } = (await request.json().catch(() => ({}))) as {
    paused?: unknown;
    assertion?: AuthenticationResponseJSON;
  };
  if (typeof paused !== "boolean")
    return NextResponse.json(
      { error: "paused must be true or false" },
      { status: 400 }
    );
  try {
    if (!paused)
      await verifyPresence(
        relyingParty(request.headers),
        assertion,
        "resume",
        resumePresence(id)
      );
    setPaused(id, paused);
    return NextResponse.json({ paused });
  } catch (error) {
    return refusalResponse(error);
  }
}
