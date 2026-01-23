import { NextRequest, NextResponse } from "next/server";
import {
  getProject,
  getProjectRepositories,
  addProjectRepository,
} from "@/lib/projects";

interface RouteParams {
  params: Promise<{ id: string }>;
}

// GET /api/projects/[id]/repositories - List repositories for a project
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const project = getProject(id);

    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    const repositories = getProjectRepositories(id);
    return NextResponse.json({ repositories });
  } catch (error) {
    console.error("Error fetching repositories:", error);
    return NextResponse.json(
      { error: "Failed to fetch repositories" },
      { status: 500 }
    );
  }
}

// POST /api/projects/[id]/repositories - Add a repository to a project
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const project = getProject(id);

    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    if (project.is_uncategorized) {
      return NextResponse.json(
        { error: "Cannot add repositories to Uncategorized project" },
        { status: 400 }
      );
    }

    const body = await request.json();
    const { name, path, isPrimary } = body;

    if (!name || !path) {
      return NextResponse.json(
        { error: "Name and path are required" },
        { status: 400 }
      );
    }

    const repository = addProjectRepository(id, {
      name,
      path,
      isPrimary,
    });

    return NextResponse.json({ repository }, { status: 201 });
  } catch (error) {
    console.error("Error adding repository:", error);
    return NextResponse.json(
      { error: "Failed to add repository" },
      { status: 500 }
    );
  }
}
