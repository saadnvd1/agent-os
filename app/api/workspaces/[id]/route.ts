import { NextRequest, NextResponse } from "next/server";
import { deleteWorkspace, updateWorkspace } from "@/lib/workspaces";

type RouteParams = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const { name, collapsed, sortOrder, maxRunningTasks } = await request.json();
  let workspace;
  try {
    workspace = updateWorkspace(id, {
      name,
      collapsed,
      sortOrder,
      maxRunningTasks,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
  if (!workspace) {
    return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
  }
  return NextResponse.json({ workspace });
}

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  deleteWorkspace((await params).id);
  return NextResponse.json({ success: true });
}
