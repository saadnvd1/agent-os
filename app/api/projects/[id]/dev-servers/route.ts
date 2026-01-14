import { NextRequest, NextResponse } from "next/server";
import { getProject, addProjectDevServer } from "@/lib/projects";

interface RouteParams {
  params: Promise<{ id: string }>;
}

// POST /api/projects/[id]/dev-servers - Add a dev server config to a project
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const project = getProject(id);

    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    if (project.is_uncategorized) {
      return NextResponse.json(
        { error: "Cannot add dev servers to Uncategorized project" },
        { status: 400 }
      );
    }

    const body = await request.json();
    const { name, type, command, port, portEnvVar } = body;

    if (!name || !type || !command) {
      return NextResponse.json(
        { error: "Name, type, and command are required" },
        { status: 400 }
      );
    }

    const devServer = addProjectDevServer(id, {
      name,
      type,
      command,
      port,
      portEnvVar,
    });

    return NextResponse.json({ devServer }, { status: 201 });
  } catch (error) {
    console.error("Error adding dev server config:", error);
    return NextResponse.json(
      { error: "Failed to add dev server config" },
      { status: 500 }
    );
  }
}
