import { NextRequest, NextResponse } from "next/server";
import { db, queries, type Session } from "@/lib/db";
import { ensureMcpConfig } from "@/lib/mcp-config";

// POST /api/sessions/[id]/mcp-config - Ensure MCP config exists for this session
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const session = queries.getSession(db).get(id) as Session | undefined;

    if (!session) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    // Expand ~ to home directory
    const workingDirectory = session.working_directory.replace(
      /^~/,
      process.env.HOME || ""
    );

    ensureMcpConfig(workingDirectory, id);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to write MCP config:", error);
    return NextResponse.json(
      { error: "Failed to write MCP config" },
      { status: 500 }
    );
  }
}
