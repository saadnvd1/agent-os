import { NextRequest, NextResponse } from "next/server";
import { deleteWorkspace, updateWorkspace } from "@/lib/workspaces";
import { applyMcpServers } from "@/lib/orchestrator/mcp-servers";

type RouteParams = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const {
    name,
    collapsed,
    sortOrder,
    maxRunningTasks,
    wakeTasksOnPR,
    orchFullAccess,
    mcpServers,
  } = await request.json();
  if (wakeTasksOnPR !== undefined && typeof wakeTasksOnPR !== "boolean")
    return NextResponse.json(
      { error: "wakeTasksOnPR is true or false" },
      { status: 400 }
    );
  if (orchFullAccess !== undefined && typeof orchFullAccess !== "boolean")
    return NextResponse.json(
      { error: "orchFullAccess is true or false" },
      { status: 400 }
    );
  let workspace;
  try {
    workspace = updateWorkspace(id, {
      name,
      collapsed,
      sortOrder,
      maxRunningTasks,
      wakeTasksOnPR,
      orchFullAccess,
      mcpServers,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
  if (!workspace) {
    return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
  }
  if (mcpServers !== undefined || orchFullAccess !== undefined)
    await applyMcpServers(id);
  return NextResponse.json({ workspace });
}

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  deleteWorkspace((await params).id);
  return NextResponse.json({ success: true });
}
