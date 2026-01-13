import { NextRequest, NextResponse } from "next/server";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

// Get terminal preview (last N lines) from tmux session
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const sessionName = `claude-${id}`;

    // Capture last 20 lines from tmux pane
    const { stdout } = await execAsync(
      `tmux capture-pane -t "${sessionName}" -p -S -20 2>/dev/null || echo ""`
    );

    const lines = stdout.split("\n");

    return NextResponse.json({ lines });
  } catch (error) {
    console.error("Error getting session preview:", error);
    return NextResponse.json({ lines: [] });
  }
}
