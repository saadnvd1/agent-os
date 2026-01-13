import { NextRequest, NextResponse } from "next/server";
import { detectServers } from "@/lib/dev-servers";
import { db, queries, Session } from "@/lib/db";

// GET /api/dev-servers/detect?sessionId=X - Auto-detect available dev servers
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const sessionId = searchParams.get("sessionId");

    if (!sessionId) {
      return NextResponse.json(
        { error: "sessionId is required" },
        { status: 400 }
      );
    }

    const session = queries.getSession(db).get(sessionId) as Session | undefined;
    if (!session) {
      return NextResponse.json(
        { error: "Session not found" },
        { status: 404 }
      );
    }

    // Use worktree path if available, otherwise session working directory
    const workingDir = session.worktree_path || session.working_directory;

    // Expand ~ to home directory
    const expandedPath = workingDir.startsWith("~")
      ? workingDir.replace("~", process.env.HOME || "")
      : workingDir;

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
