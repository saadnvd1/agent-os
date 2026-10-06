import { NextRequest, NextResponse } from "next/server";
import { getWorkspace } from "@/lib/workspaces";
import { setPaused } from "@/lib/orchestrator/pause";

type RouteParams = { params: Promise<{ id: string }> };

// Pause or resume the workspace's orchestrator: { paused: boolean }.
export async function POST(request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  if (!getWorkspace(id))
    return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
  const { paused } = await request.json().catch(() => ({}));
  if (typeof paused !== "boolean")
    return NextResponse.json(
      { error: "paused must be true or false" },
      { status: 400 }
    );
  setPaused(id, paused);
  return NextResponse.json({ paused });
}
