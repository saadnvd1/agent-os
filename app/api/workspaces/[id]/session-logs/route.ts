import { NextRequest, NextResponse } from "next/server";
import { getHq, setHq } from "@/lib/session-logs";
import { getWorkspace } from "@/lib/workspaces";
import { requireLocalTrust } from "@/lib/security/route-guard";

type RouteParams = { params: Promise<{ id: string }> };

const state = (id: string) => ({ hq: getHq(id) });

// GET/PUT /api/workspaces/:id/session-logs {folder} - the workspace's HQ
// folder, where session logs are written and committed.
export async function GET(_request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  if (!getWorkspace(id))
    return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
  return NextResponse.json(state(id));
}

// Saving checks the folder and asks GitHub about it, so only from this
// machine or the tailnet.
export async function PUT(request: NextRequest, { params }: RouteParams) {
  const refused = requireLocalTrust(request);
  if (refused) return refused;
  const { id } = await params;
  if (!getWorkspace(id))
    return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
  try {
    const { folder } = await request.json();
    await setHq(id, typeof folder === "string" ? folder : null);
    return NextResponse.json(state(id));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
