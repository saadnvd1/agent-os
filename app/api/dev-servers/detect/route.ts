import { NextRequest, NextResponse } from "next/server";
import { detectServers } from "@/lib/dev-servers";
import { db, queries, Project } from "@/lib/db";

// GET /api/dev-servers/detect?projectId=X - Auto-detect available dev servers
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get("projectId");

    if (!projectId) {
      return NextResponse.json(
        { error: "projectId is required" },
        { status: 400 }
      );
    }

    const project = queries.getProject(db).get(projectId) as Project | undefined;
    if (!project) {
      return NextResponse.json(
        { error: "Project not found" },
        { status: 404 }
      );
    }

    // Expand ~ to home directory
    const expandedPath = project.working_directory.startsWith("~")
      ? project.working_directory.replace("~", process.env.HOME || "")
      : project.working_directory;

    const servers = await detectServers(expandedPath);
    return NextResponse.json({ servers, workingDirectory: expandedPath });
  } catch (error) {
    console.error("Error detecting dev servers:", error);
    return NextResponse.json(
      { error: "Failed to detect dev servers" },
      { status: 500 }
    );
  }
}
