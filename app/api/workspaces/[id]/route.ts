import { NextRequest, NextResponse } from "next/server";
import { deleteWorkspace, updateWorkspace } from "@/lib/workspaces";

type RouteParams = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const { name, collapsed, sortOrder } = await request.json();
  const workspace = updateWorkspace(id, { name, collapsed, sortOrder });
  if (!workspace) {
    return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
  }
  return NextResponse.json({ workspace });
}

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  deleteWorkspace((await params).id);
  return NextResponse.json({ success: true });
}
