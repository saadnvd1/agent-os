import { NextResponse } from "next/server";
import { getDb, queries, type Session } from "@/lib/db";
import { getManagedSessionPattern } from "@/lib/providers/registry";
import { tmux } from "@/lib/tmux/exec";

// POST /api/tmux/kill-all - Kill all AgentOS tmux sessions and remove from database
export async function POST() {
  try {
    const db = getDb();

    // Get all tmux sessions
    // No server running means no sessions.
    const stdout = await tmux(
      ["list-sessions", "-F", "#{session_name}"],
      5000
    ).catch(() => "");

    const managedSessionPattern = getManagedSessionPattern();
    const tmuxSessions = stdout
      .trim()
      .split("\n")
      .filter((s) => s && managedSessionPattern.test(s));

    // Kill each tmux session
    const killed: string[] = [];
    for (const session of tmuxSessions) {
      try {
        await tmux(["kill-session", "-t", `=${session}`], 5000);
        killed.push(session);
      } catch {
        // Session might already be dead, continue
      }
    }

    // Delete every session from the database but the workspaces'
    // orchestrators, which are never swept.
    const dbSessions = (queries.getAllSessions(db).all() as Session[]).filter(
      (s) => s.role !== "orchestrator"
    );
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
