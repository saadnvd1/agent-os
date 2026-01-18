import { NextRequest, NextResponse } from "next/server";
import {
  updateProjectRepository,
  deleteProjectRepository,
} from "@/lib/projects";
import { queries, db, type ProjectRepository } from "@/lib/db";

interface RouteParams {
  params: Promise<{ id: string; repoId: string }>;
}

// PATCH /api/projects/[id]/repositories/[repoId] - Update a repository
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const { repoId } = await params;

    const existing = queries.getProjectRepository(db).get(repoId) as
      | (Omit<ProjectRepository, "is_primary"> & { is_primary: number })
      | undefined;
    if (!existing) {
      return NextResponse.json(
        { error: "Repository not found" },
        { status: 404 }
      );
    }

    const body = await request.json();
    const { name, path, isPrimary, sortOrder } = body;

    const repository = updateProjectRepository(repoId, {
      name,
      path,
      isPrimary,
      sortOrder,
    });

    return NextResponse.json({ repository });
  } catch (error) {
    console.error("Error updating repository:", error);
    return NextResponse.json(
      { error: "Failed to update repository" },
      { status: 500 }
    );
  }
}

// DELETE /api/projects/[id]/repositories/[repoId] - Delete a repository
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const { repoId } = await params;

    const existing = queries.getProjectRepository(db).get(repoId) as
      | (Omit<ProjectRepository, "is_primary"> & { is_primary: number })
      | undefined;
    if (!existing) {
      return NextResponse.json(
        { error: "Repository not found" },
        { status: 404 }
      );
    }

    deleteProjectRepository(repoId);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting repository:", error);
    return NextResponse.json(
      { error: "Failed to delete repository" },
      { status: 500 }
    );
  }
}
