import { NextRequest, NextResponse } from "next/server";
import {
  getSSHConnectionById,
  updateSSHConnection,
  deleteSSHConnection,
} from "@/lib/ssh-connections";

interface RouteParams {
  params: Promise<{ id: string }>;
}

// GET /api/ssh-connections/[id] - Get single SSH connection
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const connection = getSSHConnectionById(id);

    if (!connection) {
      return NextResponse.json(
        { error: "SSH connection not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ connection });
  } catch (error: unknown) {
    const err = error as { message?: string };
    console.error("Error fetching SSH connection:", error);
    return NextResponse.json(
      { error: err.message || "Failed to fetch SSH connection" },
      { status: 500 }
    );
  }
}

// PATCH /api/ssh-connections/[id] - Update SSH connection
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const body = await request.json();

    const existing = getSSHConnectionById(id);
    if (!existing) {
      return NextResponse.json(
        { error: "SSH connection not found" },
        { status: 404 }
      );
    }

    // Update the connection
    updateSSHConnection(id, body);

    // Fetch updated connection
    const updated = getSSHConnectionById(id);
    return NextResponse.json({ connection: updated });
  } catch (error: unknown) {
    const err = error as { message?: string };
    console.error("Error updating SSH connection:", error);
    return NextResponse.json(
      { error: err.message || "Failed to update SSH connection" },
      { status: 500 }
    );
  }
}

// DELETE /api/ssh-connections/[id] - Delete SSH connection
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;

    deleteSSHConnection(id);
    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    const err = error as { message?: string };
    console.error("Error deleting SSH connection:", error);
    return NextResponse.json(
      { error: err.message || "Failed to delete SSH connection" },
      { status: 500 }
    );
  }
}
