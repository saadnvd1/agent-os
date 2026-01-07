import { NextResponse } from "next/server";
import { exec } from "child_process";
import { promisify } from "util";
import { db } from "@/lib/db";

const execAsync = promisify(exec);

// GET: Check tmux environment for Claude session ID
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const tmuxSession = `claude-${id}`;

  try {
    // Check tmux environment for CLAUDE_SESSION_ID
    const { stdout } = await execAsync(
      `tmux show-environment -t "${tmuxSession}" CLAUDE_SESSION_ID 2>/dev/null || echo ""`
    );

    const line = stdout.trim();
    if (line.startsWith("CLAUDE_SESSION_ID=")) {
      const sessionId = line.replace("CLAUDE_SESSION_ID=", "");
      if (sessionId && sessionId !== "null") {
        // Update database with the session ID
        const stmt = db.prepare(
          "UPDATE sessions SET claude_session_id = ?, updated_at = datetime('now') WHERE id = ?"
        );
        stmt.run(sessionId, id);

        return NextResponse.json({ claude_session_id: sessionId });
      }
    }

    return NextResponse.json({ claude_session_id: null });
  } catch (error) {
    console.error("Error getting Claude session ID:", error);
    return NextResponse.json({ claude_session_id: null });
  }
}
