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

    // Capture visible pane content plus scrollback, take last 50 lines
    const { stdout } = await execAsync(
      `tmux capture-pane -t "${sessionName}" -p -S -100 2>/dev/null || echo ""`
    );

    // Take the last 50 non-empty lines (trim trailing empty lines)
    const allLines = stdout.split("\n");
    let lastNonEmpty = allLines.length - 1;
    while (lastNonEmpty > 0 && allLines[lastNonEmpty].trim() === "") {
      lastNonEmpty--;
    }
    const lines = allLines.slice(Math.max(0, lastNonEmpty - 49), lastNonEmpty + 1);

    return NextResponse.json({ lines });
  } catch (error) {
    console.error("Error getting session preview:", error);
    return NextResponse.json({ lines: [] });
  }
}
