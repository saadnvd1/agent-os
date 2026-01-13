import { NextRequest, NextResponse } from "next/server";
import { exec, spawn } from "child_process";
import { promisify } from "util";
import { getDb, queries, type Session } from "@/lib/db";
import { randomUUID } from "crypto";
import { writeFileSync, unlinkSync } from "fs";

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

// Get the actual working directory from tmux pane
async function getTmuxCwd(sessionName: string): Promise<string | null> {
  try {
    const { stdout } = await execAsync(
      `tmux display-message -t "${sessionName}" -p "#{pane_current_path}" 2>/dev/null`
    );
    return stdout.trim() || null;
  } catch {
    return null;
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

// Wait for Claude prompt to appear in tmux session
async function waitForClaudeReady(sessionName: string, maxAttempts = 30): Promise<boolean> {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const { stdout } = await execAsync(
        `tmux capture-pane -t "${sessionName}" -p 2>/dev/null`
      );
      // Look for Claude's status line which appears when UI is ready
      if (stdout.includes("⏵⏵") || stdout.includes("accept edits")) {
        return true;
      }
    } catch {
      // Ignore errors, keep polling
    }
    await new Promise(r => setTimeout(r, 300));
  }
  return false;
}

// Send text to tmux session using load-buffer + paste-buffer
async function sendToTmux(sessionName: string, text: string, pressEnter = true): Promise<void> {
  const tempFile = `/tmp/agent-os-send-${Date.now()}.txt`;
  const bufferName = `send-${Date.now()}`;

  try {
    writeFileSync(tempFile, text);
    await execAsync(`tmux load-buffer -b "${bufferName}" "${tempFile}"`);
    await execAsync(`tmux paste-buffer -b "${bufferName}" -t "${sessionName}"`);
    await execAsync(`tmux delete-buffer -b "${bufferName}"`).catch(() => {});

    if (pressEnter) {
      // Wait for Claude to process pasted text before sending Enter
      await new Promise(r => setTimeout(r, 500));
      await execAsync(`tmux send-keys -t "${sessionName}" Enter`);
    }
  } finally {
    try { unlinkSync(tempFile); } catch {}
  }
}

// POST /api/sessions/[id]/summarize - Summarize and create fresh session
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const { createFork = true, sendContext = true } = body;

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

    // Create a new session with the summary as context
    let newSession: Session | null = null;
    if (createFork) {
      const newId = randomUUID();
      const newName = `${session.name} (fresh)`;

      // Get actual working directory from tmux (falls back to session's stored value)
      const actualCwd = await getTmuxCwd(tmuxSessionName) || session.working_directory;
      const cwdExpanded = actualCwd?.replace(/^~/, process.env.HOME || "~") || process.env.HOME || "~";

      // Create new session in DB
      queries.createSession(db).run(
        newId,
        newName,
        actualCwd,
        null, // no parent - fresh start
        session.model,
        `Continue from previous session. Here's a summary of the work so far:\n\n${summary}`,
        session.group_path,
        session.agent_type,
        session.auto_approve ? 1 : 0
      );

      newSession = queries.getSession(db).get(newId) as Session;
      const newTmuxSession = `claude-${newId}`;

      // Start new tmux session with Claude directly
      const claudeCmd = session.auto_approve
        ? "claude --dangerously-skip-permissions"
        : "claude";

      const tmuxCmd = `tmux new-session -d -s "${newTmuxSession}" -c "${cwdExpanded}" "${claudeCmd}"`;
      console.log(`[summarize] Creating tmux session: ${tmuxCmd}`);
      await execAsync(tmuxCmd);
      console.log(`[summarize] Tmux session created: ${newTmuxSession}`);

      // Give Claude a moment to start up before polling
      await new Promise(r => setTimeout(r, 2000));

      // Wait for Claude to be ready and send context
      if (sendContext) {
        console.log(`[summarize] Waiting for Claude to be ready...`);
        const ready = await waitForClaudeReady(newTmuxSession);
        console.log(`[summarize] Claude ready: ${ready}`);
        if (ready) {
          const contextMessage = `Here's a summary of the previous session to continue from:\n\n${summary}\n\nPlease acknowledge you've received this context and are ready to continue.`;
          console.log(`[summarize] Sending context message (${contextMessage.length} chars)`);
          await sendToTmux(newTmuxSession, contextMessage, true);
          console.log(`[summarize] Context sent!`);
        } else {
          console.log(`[summarize] WARNING: Claude not ready, skipping context send`);
        }
      }
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
