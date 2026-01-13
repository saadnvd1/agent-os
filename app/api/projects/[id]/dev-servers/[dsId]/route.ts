import { NextRequest, NextResponse } from "next/server";
import {
  updateProjectDevServer,
  deleteProjectDevServer,
} from "@/lib/projects";
import { queries, db, type ProjectDevServer } from "@/lib/db";

interface RouteParams {
  params: Promise<{ id: string; dsId: string }>;
}

// PATCH /api/projects/[id]/dev-servers/[dsId] - Update a dev server config
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const { dsId } = await params;

    const existing = queries.getProjectDevServer(db).get(dsId) as ProjectDevServer | undefined;
    if (!existing) {
      return NextResponse.json(
        { error: "Dev server config not found" },
        { status: 404 }
      );
    }

    const body = await request.json();
    const { name, type, command, port, portEnvVar, sortOrder } = body;

    const devServer = updateProjectDevServer(dsId, {
      name,
      type,
      command,
      port,
      portEnvVar,
      sortOrder,
    });

    return NextResponse.json({ devServer });
  } catch (error) {
    console.error("Error updating dev server config:", error);
    return NextResponse.json(
      { error: "Failed to update dev server config" },
      { status: 500 }
    );
  }
}

// DELETE /api/projects/[id]/dev-servers/[dsId] - Delete a dev server config
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const { dsId } = await params;

    const existing = queries.getProjectDevServer(db).get(dsId) as ProjectDevServer | undefined;
    if (!existing) {
      return NextResponse.json(
        { error: "Dev server config not found" },
        { status: 404 }
      );
    }

    deleteProjectDevServer(dsId);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting dev server config:", error);
    return NextResponse.json(
      { error: "Failed to delete dev server config" },
      { status: 500 }
    );
  }
}
