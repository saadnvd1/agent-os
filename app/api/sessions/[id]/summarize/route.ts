import { NextRequest, NextResponse } from "next/server";
import { exec } from "child_process";
import { promisify } from "util";
import { getDb, queries, type Session } from "@/lib/db";
import { randomUUID } from "crypto";

const execAsync = promisify(exec);

// Capture full tmux scrollback
async function captureScrollback(sessionName: string): Promise<string> {
  try {
    const { stdout } = await execAsync(
      `tmux capture-pane -t "${sessionName}" -p -S - -E - 2>/dev/null`
    );
    return stdout;
  } catch {
    return "";
  }
}

// Generate summary using Claude CLI
async function generateSummary(conversation: string): Promise<string> {
  const prompt = `Summarize this Claude Code conversation concisely. Focus on:
1. What task/problem was being worked on
2. Key decisions made and why
3. Current state/progress
4. Any important context for continuing the work

Keep it under 500 words. Output ONLY the summary, no preamble.`;

  try {
    const { stdout } = await execAsync(
      `echo ${JSON.stringify(conversation)} | claude -p ${JSON.stringify(prompt)}`,
      { maxBuffer: 10 * 1024 * 1024 } // 10MB buffer for large conversations
    );
    return stdout.trim();
  } catch (error) {
    console.error("Failed to generate summary:", error);
    throw new Error("Failed to generate summary with Claude CLI");
  }
}

// POST /api/sessions/[id]/summarize - Summarize and optionally fork
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const { createFork = true } = body;

    const db = getDb();
    const session = queries.getSession(db).get(id) as Session | undefined;

    if (!session) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    // Only support Claude sessions for now
    if (session.agent_type !== "claude") {
      return NextResponse.json(
        { error: "Summarize is only supported for Claude sessions" },
        { status: 400 }
      );
    }

    // Get tmux session name
    const tmuxSessionName = `claude-${id}`;

    // Capture scrollback
    const scrollback = await captureScrollback(tmuxSessionName);
    if (!scrollback || scrollback.trim().length < 100) {
      return NextResponse.json(
        { error: "No conversation found to summarize" },
        { status: 400 }
      );
    }

    // Generate summary
    const summary = await generateSummary(scrollback);

    // Optionally create a forked session with the summary as context
    let newSession: Session | null = null;
    if (createFork) {
      const newId = randomUUID();
      const newName = `${session.name} (fresh)`;

      // Create new session
      queries.createSession(db).run(
        newId,
        newName,
        session.working_directory,
        null, // no parent - fresh start
        session.model,
        `Continue from previous session. Here's a summary of the work so far:\n\n${summary}`,
        session.group_path,
        session.agent_type,
        session.auto_approve ? 1 : 0
      );

      newSession = queries.getSession(db).get(newId) as Session;
    }

    return NextResponse.json({
      summary,
      newSession,
    });
  } catch (error) {
    console.error("Error summarizing session:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
