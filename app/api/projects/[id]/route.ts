import { NextRequest, NextResponse } from "next/server";
import {
  getProjectWithDevServers,
  updateProject,
  deleteProject,
  toggleProjectExpanded,
} from "@/lib/projects";

interface RouteParams {
  params: Promise<{ id: string }>;
}

// GET /api/projects/[id] - Get a single project with dev servers
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const project = getProjectWithDevServers(id);

    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    return NextResponse.json({ project });
  } catch (error) {
    console.error("Error getting project:", error);
    return NextResponse.json(
      { error: "Failed to get project" },
      { status: 500 }
    );
  }
}

// PATCH /api/projects/[id] - Update a project
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const body = await request.json();
    const {
      name,
      workingDirectory,
      agentType,
      defaultModel,
      initialPrompt,
      expanded,
    } = body;

    // Handle expanded toggle separately
    if (typeof expanded === "boolean") {
      toggleProjectExpanded(id, expanded);
    }

    // Update other fields if provided
    if (
      name ||
      workingDirectory ||
      agentType ||
      defaultModel ||
      initialPrompt !== undefined
    ) {
      const project = updateProject(id, {
        name,
        working_directory: workingDirectory,
        agent_type: agentType,
        default_model: defaultModel,
        initial_prompt: initialPrompt,
      });

      if (!project) {
        return NextResponse.json(
          { error: "Project not found or cannot be modified" },
          { status: 404 }
        );
      }
    }

    const updated = getProjectWithDevServers(id);
    return NextResponse.json({ project: updated });
  } catch (error) {
    console.error("Error updating project:", error);
    return NextResponse.json(
      { error: "Failed to update project" },
      { status: 500 }
    );
  }
}

// DELETE /api/projects/[id] - Delete a project
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const deleted = deleteProject(id);

    if (!deleted) {
      return NextResponse.json(
        { error: "Project not found or cannot be deleted" },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting project:", error);
    return NextResponse.json(
      { error: "Failed to delete project" },
      { status: 500 }
    );
  }
}
