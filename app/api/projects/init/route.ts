import { NextRequest, NextResponse } from "next/server";
import { addFolder, initProject, ProjectExistsError } from "@/lib/project-add";

// POST /api/projects/init - a project from a folder that exists ({ path }),
// or a new one from a name ({ parent, name }: folder, git init, first commit),
// in { workspaceId } when given. A folder that's already a project answers
// 409 with it, unless { moveExisting } moves it into the workspace.
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const hostId = typeof body.hostId === "string" ? body.hostId : "local";
    const workspaceId =
      typeof body.workspaceId === "string" ? body.workspaceId : null;
    const project =
      typeof body.path === "string"
        ? (
            await addFolder(hostId, body.path, {
              workspaceId,
              moveExisting: body.moveExisting === true,
            })
          ).project
        : await initProject(
            hostId,
            String(body.parent ?? "~"),
            String(body.name ?? ""),
            workspaceId
          );
    return NextResponse.json({ project }, { status: 201 });
  } catch (error) {
    if (error instanceof ProjectExistsError) {
      const { id, name, workspace_id } = error.project;
      return NextResponse.json(
        {
          error: error.message,
          existing: { id, name, workspaceId: workspace_id },
        },
        { status: 409 }
      );
    }
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: message.trim().split("\n").pop() },
      { status: 400 }
    );
  }
}
