import { NextRequest, NextResponse } from "next/server";
import { getAllServers, startServer } from "@/lib/dev-servers";

// GET /api/dev-servers - List all servers with live status
export async function GET() {
  try {
    const servers = await getAllServers();
    return NextResponse.json({ servers });
  } catch (error) {
    console.error("Error getting dev servers:", error);
    return NextResponse.json(
      { error: "Failed to get dev servers" },
      { status: 500 }
    );
  }
}

// POST /api/dev-servers - Start a new server
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { projectId, type, name, command, workingDirectory, ports } = body;

    if (!projectId || !type || !name || !command || !workingDirectory) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    const server = await startServer({
      projectId,
      type,
      name,
      command,
      workingDirectory,
      ports,
    });

    return NextResponse.json({ server });
  } catch (error) {
    console.error("Error starting dev server:", error);
    return NextResponse.json(
      { error: "Failed to start dev server" },
      { status: 500 }
    );
  }
}
