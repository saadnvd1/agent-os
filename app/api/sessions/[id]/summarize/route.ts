import { NextRequest, NextResponse } from "next/server";
import { exec, spawn } from "child_process";
import { promisify } from "util";
import { getDb, queries, type Session } from "@/lib/db";
import { randomUUID } from "crypto";

const execAsync = promisify(exec);

// Capture recent tmux scrollback (last 500 lines for reasonable context)
async function captureScrollback(sessionName: string): Promise<string> {
  try {
    const { stdout } = await execAsync(
      `tmux capture-pane -t "${sessionName}" -p -S -500 2>/dev/null`
    );
    return stdout;
  } catch {
    return "";
  }
}

// Generate summary using Claude CLI with stdin
async function generateSummary(conversation: string): Promise<string> {
  const prompt = `Summarize this Claude Code terminal output in under 300 words. Focus on: what was built, key files changed, current state. Be specific.`;

  return new Promise((resolve, reject) => {
    const claude = spawn("claude", ["-p", prompt], {
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    claude.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    claude.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    claude.on("close", (code) => {
      if (code === 0) {
        resolve(stdout.trim());
      } else {
        console.error("Claude CLI failed:", stderr);
        reject(new Error(`Claude CLI exited with code ${code}`));
      }
    });

    claude.on("error", (err) => {
      reject(err);
    });

    // Write conversation to stdin
    claude.stdin.write(conversation);
    claude.stdin.end();
  });
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
