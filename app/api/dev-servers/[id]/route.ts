import { NextRequest, NextResponse } from "next/server";
import { db, queries, DevServer } from "@/lib/db";
import { getServerStatus, removeServer } from "@/lib/dev-servers";

// GET /api/dev-servers/[id] - Get single server with live status
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const server = queries.getDevServer(db).get(id) as DevServer | undefined;

    if (!server) {
      return NextResponse.json({ error: "Server not found" }, { status: 404 });
    }

    // Get live status
    const liveStatus = await getServerStatus(server);
    if (liveStatus !== server.status) {
      queries.updateDevServerStatus(db).run(liveStatus, id);
      server.status = liveStatus;
    }

    return NextResponse.json({ server });
  } catch (error) {
    console.error("Error getting dev server:", error);
    return NextResponse.json(
      { error: "Failed to get dev server" },
      { status: 500 }
    );
  }
}

// DELETE /api/dev-servers/[id] - Stop and remove server
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    await removeServer(id);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error removing dev server:", error);
    return NextResponse.json(
      { error: "Failed to remove dev server" },
      { status: 500 }
    );
  }
}
