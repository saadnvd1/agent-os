import { NextRequest, NextResponse } from "next/server";
import { exec, spawn } from "child_process";
import { promisify } from "util";
import { getDb, queries, type Session } from "@/lib/db";
import { randomUUID } from "crypto";
import { writeFileSync, unlinkSync, readFileSync, existsSync } from "fs";
import { homedir } from "os";

const execAsync = promisify(exec);

// Get Claude session ID from tmux environment
async function getClaudeSessionId(tmuxSession: string): Promise<string | null> {
  try {
    const { stdout } = await execAsync(
      `tmux show-environment -t "${tmuxSession}" CLAUDE_SESSION_ID 2>/dev/null || echo ""`
    );
    const line = stdout.trim();
    if (line.startsWith("CLAUDE_SESSION_ID=")) {
      const sessionId = line.replace("CLAUDE_SESSION_ID=", "");
      return sessionId && sessionId !== "null" ? sessionId : null;
    }
    return null;
  } catch {
    return null;
  }
}

// Encode path for Claude's project directory format (/ becomes -)
function encodeProjectPath(cwd: string): string {
  return cwd.replace(/\//g, "-");
}

// Read and parse Claude session JSONL file
function readClaudeSessionHistory(cwd: string, claudeSessionId: string): string | null {
  const projectPath = encodeProjectPath(cwd);
  const jsonlPath = `${homedir()}/.claude/projects/${projectPath}/${claudeSessionId}.jsonl`;

  if (!existsSync(jsonlPath)) {
    console.log(`[summarize] JSONL not found: ${jsonlPath}`);
    return null;
  }

  try {
    const content = readFileSync(jsonlPath, "utf-8");
    const lines = content.trim().split("\n");
    const messages: string[] = [];

    for (const line of lines) {
      try {
        const entry = JSON.parse(line);

        // Extract user messages
        if (entry.type === "user" && entry.message?.content) {
          const content = typeof entry.message.content === "string"
            ? entry.message.content
            : JSON.stringify(entry.message.content);
          messages.push(`User: ${content}`);
        }

        // Extract assistant text responses (skip tool calls and thinking)
        if (entry.type === "assistant" && entry.message?.content) {
          const textBlocks = entry.message.content
            .filter((block: { type: string }) => block.type === "text")
            .map((block: { text: string }) => block.text)
            .join("\n");
          if (textBlocks) {
            messages.push(`Assistant: ${textBlocks}`);
          }
        }
      } catch {
        // Skip malformed lines
      }
    }

    return messages.join("\n\n");
  } catch (error) {
    console.error(`[summarize] Error reading JSONL:`, error);
    return null;
  }
}

// Fallback: Capture recent tmux scrollback (last 500 lines)
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
  const prompt = `Summarize this Claude Code conversation in under 300 words. Focus on: what was built, key files changed, current state, and any pending work. Be specific.`;

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

    // Get tmux session name (pattern: {agent_type}-{id})
    const tmuxSessionName = `${session.agent_type}-${id}`;

    // Get actual working directory from tmux
    const cwd = await getTmuxCwd(tmuxSessionName) || session.working_directory;
    const cwdExpanded = cwd?.replace(/^~/, process.env.HOME || "~") || process.env.HOME || "~";

    // Try to get full conversation from Claude's JSONL (only for Claude sessions)
    let conversation: string | null = null;
    if (session.agent_type === "claude") {
      const claudeSessionId = await getClaudeSessionId(tmuxSessionName);
      if (claudeSessionId && cwdExpanded) {
        console.log(`[summarize] Found Claude session ID: ${claudeSessionId}`);
        conversation = readClaudeSessionHistory(cwdExpanded, claudeSessionId);
        if (conversation) {
          console.log(`[summarize] Read ${conversation.length} chars from JSONL`);
        }
      }
    }

    // Fallback to terminal scrollback for non-Claude or if JSONL not available
    if (!conversation) {
      console.log(`[summarize] Using terminal scrollback for ${session.agent_type}`);
      conversation = await captureScrollback(tmuxSessionName);
    }

    if (!conversation || conversation.trim().length < 100) {
      return NextResponse.json(
        { error: "No conversation found to summarize" },
        { status: 400 }
      );
    }

    // Generate summary
    const summary = await generateSummary(conversation);

    // Create a new session with the summary as context
    let newSession: Session | null = null;
    if (createFork) {
      const newId = randomUUID();
      const newName = `${session.name} (fresh)`;

      // Create new session in DB (using cwd already fetched above)
      queries.createSession(db).run(
        newId,
        newName,
        cwd,
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
