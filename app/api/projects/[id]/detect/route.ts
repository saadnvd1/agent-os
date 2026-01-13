import { NextRequest, NextResponse } from "next/server";
import { getProject, detectDevServers } from "@/lib/projects";

interface RouteParams {
  params: Promise<{ id: string }>;
}

// GET /api/projects/[id]/detect - Detect available dev servers for a project
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const project = getProject(id);

    if (!project) {
      return NextResponse.json(
        { error: "Project not found" },
        { status: 404 }
      );
    }

    const detected = await detectDevServers(project.working_directory);
    return NextResponse.json({ detected });
  } catch (error) {
    console.error("Error detecting dev servers:", error);
    return NextResponse.json(
      { error: "Failed to detect dev servers" },
      { status: 500 }
    );
  }
}
