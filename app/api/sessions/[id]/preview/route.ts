import { NextRequest, NextResponse } from "next/server";
import { queries, getDb, type Session } from "@/lib/db";
import { hostExec } from "@/lib/hosts";
import { isValidTmuxName } from "@/lib/hosts/attach";
import { controlManager } from "@/lib/tmux/control";

// Get terminal preview (last N lines) from tmux session
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const db = getDb();

    // Look up session to get the tmux name
    const session = queries.getSession(db).get(id) as Session | undefined;
    const agentType = session?.agent_type || "claude";
    const sessionName = session?.tmux_name || `${agentType}-${id}`;

    // Capture visible pane content plus scrollback, take last 50 lines.
    // A session watched in control mode answers over its client.
    const watched = isValidTmuxName(sessionName)
      ? await controlManager()?.query(
          sessionName,
          `capture-pane -p -S -100 -t =${sessionName}:`
        )
      : null;
    const { stdout } = watched
      ? { stdout: watched.join("\n") }
      : await hostExec(
          session?.host_id,
          `tmux capture-pane -t "${sessionName}" -p -S -100 2>/dev/null || echo ""`
        );

    // Take the last 50 non-empty lines (trim trailing empty lines)
    const allLines = stdout.split("\n");
    let lastNonEmpty = allLines.length - 1;
    while (lastNonEmpty > 0 && allLines[lastNonEmpty].trim() === "") {
      lastNonEmpty--;
    }
    const lines = allLines.slice(
      Math.max(0, lastNonEmpty - 49),
      lastNonEmpty + 1
    );

    return NextResponse.json({ lines });
  } catch (error) {
    console.error("Error getting session preview:", error);
    return NextResponse.json({ lines: [] });
  }
}
