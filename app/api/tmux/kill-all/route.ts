import { NextResponse } from "next/server";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

// POST /api/tmux/kill-all - Kill all AgentOS tmux sessions
export async function POST() {
  try {
    // Get all tmux sessions
    const { stdout } = await execAsync(
      'tmux list-sessions -F "#{session_name}" 2>/dev/null || echo ""',
      { timeout: 5000 }
    );

    const sessions = stdout
      .trim()
      .split("\n")
      .filter((s) => s && (s.startsWith("claude-") || s.startsWith("codex-") || s.startsWith("opencode-")));

    if (sessions.length === 0) {
      return NextResponse.json({ killed: 0, sessions: [] });
    }

    // Kill each session
    const killed: string[] = [];
    for (const session of sessions) {
      try {
        await execAsync(`tmux kill-session -t "${session}"`, { timeout: 5000 });
        killed.push(session);
      } catch {
        // Session might already be dead, continue
      }
    }

    return NextResponse.json({ killed: killed.length, sessions: killed });
  } catch (error) {
    console.error("Error killing tmux sessions:", error);
    return NextResponse.json(
      { error: "Failed to kill sessions" },
      { status: 500 }
    );
  }
}
