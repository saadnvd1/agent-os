import { NextResponse } from "next/server";
import { exec } from "child_process";
import { promisify } from "util";
import { getDb, queries, type Session } from "@/lib/db";

const execAsync = promisify(exec);

// POST /api/tmux/kill-all - Kill all AgentOS tmux sessions and remove from database
export async function POST() {
  try {
    const db = getDb();

    // Get all tmux sessions
    const { stdout } = await execAsync(
      'tmux list-sessions -F "#{session_name}" 2>/dev/null || echo ""',
      { timeout: 5000 }
    );

    const tmuxSessions = stdout
      .trim()
      .split("\n")
      .filter(
        (s) => s && /^(claude|codex|opencode|gemini|aider|cursor)-/.test(s)
      );

    // Kill each tmux session
    const killed: string[] = [];
    for (const session of tmuxSessions) {
      try {
        await execAsync(`tmux kill-session -t "${session}"`, { timeout: 5000 });
        killed.push(session);
      } catch {
        // Session might already be dead, continue
      }
    }

    // Delete ALL sessions from database
    const dbSessions = queries.getAllSessions(db).all() as Session[];
    for (const session of dbSessions) {
      try {
        queries.deleteSession(db).run(session.id);
      } catch {
        // Continue on error
      }
    }

    return NextResponse.json({
      killed: killed.length,
      sessions: killed,
      deletedFromDb: dbSessions.length,
    });
  } catch (error) {
    console.error("Error killing tmux sessions:", error);
    return NextResponse.json(
      { error: "Failed to kill sessions" },
      { status: 500 }
    );
  }
}
