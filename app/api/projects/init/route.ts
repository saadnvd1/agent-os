import { NextRequest, NextResponse } from "next/server";
import { addFolder, initProject } from "@/lib/project-add";

// POST /api/projects/init - a project from a folder that exists ({ path }),
// or a new one from a name ({ parent, name }: folder, git init, first commit).
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const hostId = typeof body.hostId === "string" ? body.hostId : "local";
    const project =
      typeof body.path === "string"
        ? await addFolder(hostId, body.path)
        : await initProject(
            hostId,
            String(body.parent ?? "~"),
            String(body.name ?? "")
          );
    return NextResponse.json({ project }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: message.trim().split("\n").pop() },
      { status: 400 }
    );
  }
}
