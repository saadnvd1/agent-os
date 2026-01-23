import { NextRequest, NextResponse } from "next/server";
import {
  getAllProjectsWithDevServers,
  createProject,
  validateWorkingDirectory,
} from "@/lib/projects";

// GET /api/projects - List all projects with dev server configs
export async function GET() {
  try {
    const projects = getAllProjectsWithDevServers();
    return NextResponse.json({ projects });
  } catch (error) {
    console.error("Error getting projects:", error);
    return NextResponse.json(
      { error: "Failed to get projects" },
      { status: 500 }
    );
  }
}

// POST /api/projects - Create a new project
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      name,
      workingDirectory,
      agentType,
      defaultModel,
      devServers,
      isRemote,
      sshConnectionId,
    } = body;

    if (!name || !workingDirectory) {
      return NextResponse.json(
        { error: "Name and working directory are required" },
        { status: 400 }
      );
    }

    // Validate remote project requirements
    if (isRemote && !sshConnectionId) {
      return NextResponse.json(
        { error: "SSH connection required for remote projects" },
        { status: 400 }
      );
    }

    // For local projects, validate the working directory exists
    if (!isRemote && !validateWorkingDirectory(workingDirectory)) {
      return NextResponse.json(
        { error: "Working directory does not exist" },
        { status: 400 }
      );
    }

    const project = createProject({
      name,
      workingDirectory,
      agentType,
      defaultModel,
      devServers,
      isRemote,
      sshConnectionId,
    });

    return NextResponse.json({ project }, { status: 201 });
  } catch (error) {
    console.error("Error creating project:", error);
    return NextResponse.json(
      { error: "Failed to create project" },
      { status: 500 }
    );
  }
}
