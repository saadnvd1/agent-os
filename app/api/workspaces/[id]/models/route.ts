import { NextRequest, NextResponse } from "next/server";
import { setWorkspaceModels, workspaceModels } from "@/lib/models/config";
import { getWorkspace } from "@/lib/workspaces";
import { requireLocalTrust } from "@/lib/security/route-guard";

type RouteParams = { params: Promise<{ id: string }> };

// GET/PUT /api/workspaces/:id/models {roles} - the workspace's own role
// models, over Settings'.
export async function GET(_request: NextRequest, { params }: RouteParams) {
  return NextResponse.json(workspaceModels((await params).id));
}

// Writes only from this machine or the tailnet, like Settings' own.
export async function PUT(request: NextRequest, { params }: RouteParams) {
  const refused = requireLocalTrust(request);
  if (refused) return refused;
  const { id } = await params;
  if (!getWorkspace(id))
    return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
  try {
    return NextResponse.json(setWorkspaceModels(id, await request.json()));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
