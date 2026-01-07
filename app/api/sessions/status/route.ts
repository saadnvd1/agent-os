import { NextResponse } from "next/server";
import { exec } from "child_process";
import { promisify } from "util";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const execAsync = promisify(exec);

interface SessionStatus {
  sessionName: string;
  status: "idle" | "running" | "waiting" | "error" | "dead";
  lastLine?: string;
  claudeSessionId?: string | null;
}

// Patterns to detect Claude's state
const WAITING_PATTERNS = [
  /\[Y\/n\]/i,
  /\[y\/N\]/i,
  /Allow\?/i,
  /Approve\?/i,
  /Continue\?/i,
  /Press Enter/i,
  /waiting for/i,
  /\(yes\/no\)/i,
  /Do you want to/i,
  /Esc to cancel/i,
  />\s*1\.\s*Yes/,  // Claude's approval menu
  /Yes, allow all/i,
  /allow all edits/i,
  /allow all commands/i,
];

const RUNNING_PATTERNS = [
  /thinking/i,
  /Working/i,
  /Reading/i,
  /Writing/i,
  /Searching/i,
  /Running/i,
  /Executing/i,
  /⠋|⠙|⠹|⠸|⠼|⠴|⠦|⠧|⠇|⠏/, // Spinner characters
];

const IDLE_PATTERNS = [
  /^>\s*$/m, // Just a prompt
  /claude.*>\s*$/im,
];

async function getTmuxSessions(): Promise<string[]> {
  try {
    const { stdout } = await execAsync("tmux list-sessions -F '#{session_name}' 2>/dev/null || true");
    return stdout.trim().split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

async function getTmuxSessionCwd(sessionName: string): Promise<string | null> {
  try {
    const { stdout } = await execAsync(
      `tmux display-message -t "${sessionName}" -p "#{pane_current_path}" 2>/dev/null || echo ""`
    );
    const cwd = stdout.trim();
    return cwd || null;
  } catch {
    return null;
  }
}

// Get Claude session ID from tmux environment variable
async function getClaudeSessionIdFromEnv(sessionName: string): Promise<string | null> {
  try {
    const { stdout } = await execAsync(
      `tmux show-environment -t "${sessionName}" CLAUDE_SESSION_ID 2>/dev/null || echo ""`
    );
    const line = stdout.trim();
    if (line.startsWith("CLAUDE_SESSION_ID=")) {
      const sessionId = line.replace("CLAUDE_SESSION_ID=", "");
      if (sessionId && sessionId !== "null") {
        return sessionId;
      }
    }
    return null;
  } catch {
    return null;
  }
}

// Get Claude session ID by looking at session files on disk (like agent-deck does)
function getClaudeSessionIdFromFiles(projectPath: string): string | null {
  const home = os.homedir();
  const claudeDir = process.env.CLAUDE_CONFIG_DIR || path.join(home, ".claude");

  // Convert project path to Claude's directory format
  // /Users/saad/dev/agent-os -> -Users-saad-dev-agent-os
  const projectDirName = projectPath.replace(/\//g, "-");
  const projectDir = path.join(claudeDir, "projects", projectDirName);

  // Check if project directory exists
  if (!fs.existsSync(projectDir)) {
    return null;
  }

  // Find session files (UUID format .jsonl files)
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jsonl$/;

  try {
    const files = fs.readdirSync(projectDir);
    let mostRecent: string | null = null;
    let mostRecentTime = 0;

    for (const file of files) {
      // Skip agent files
      if (file.startsWith("agent-")) continue;

      // Only consider UUID-named files
      if (!uuidPattern.test(file)) continue;

      const filePath = path.join(projectDir, file);
      const stat = fs.statSync(filePath);

      // Find the most recently modified file
      if (stat.mtimeMs > mostRecentTime) {
        mostRecentTime = stat.mtimeMs;
        mostRecent = file.replace(".jsonl", "");
      }
    }

    // Only return if modified within last 5 minutes (actively used)
    if (mostRecent && Date.now() - mostRecentTime < 5 * 60 * 1000) {
      return mostRecent;
    }

    // Fallback: check lastSessionId in .claude.json
    const configFile = path.join(claudeDir, ".claude.json");
    if (fs.existsSync(configFile)) {
      try {
        const config = JSON.parse(fs.readFileSync(configFile, "utf-8"));
        if (config.projects?.[projectPath]?.lastSessionId) {
          return config.projects[projectPath].lastSessionId;
        }
      } catch {
        // Ignore config parse errors
      }
    }

    return null;
  } catch {
    return null;
  }
}

// Get Claude session ID - tries environment variable first, then file-based detection
async function getClaudeSessionId(sessionName: string): Promise<string | null> {
  // First try the tmux environment variable
  const envId = await getClaudeSessionIdFromEnv(sessionName);
  if (envId) {
    return envId;
  }

  // Fall back to file-based detection
  const cwd = await getTmuxSessionCwd(sessionName);
  if (cwd) {
    return getClaudeSessionIdFromFiles(cwd);
  }

  return null;
}

async function getSessionStatus(sessionName: string): Promise<SessionStatus> {
  try {
    // Capture the last 10 lines of the pane
    const { stdout } = await execAsync(
      `tmux capture-pane -t "${sessionName}" -p -S -10 2>/dev/null || echo ""`
    );

    const content = stdout.trim();
    const lastLine = content.split("\n").filter(Boolean).pop() || "";

    // Also get Claude session ID from tmux env
    const claudeSessionId = await getClaudeSessionId(sessionName);

    // Check for waiting patterns first (highest priority)
    for (const pattern of WAITING_PATTERNS) {
      if (pattern.test(content)) {
        return { sessionName, status: "waiting", lastLine, claudeSessionId };
      }
    }

    // Check for running patterns
    for (const pattern of RUNNING_PATTERNS) {
      if (pattern.test(lastLine)) {
        return { sessionName, status: "running", lastLine, claudeSessionId };
      }
    }

    // Check for idle patterns
    for (const pattern of IDLE_PATTERNS) {
      if (pattern.test(lastLine)) {
        return { sessionName, status: "idle", lastLine, claudeSessionId };
      }
    }

    // Default to running if there's recent content
    if (content.length > 0) {
      return { sessionName, status: "idle", lastLine, claudeSessionId };
    }

    return { sessionName, status: "idle", lastLine, claudeSessionId };
  } catch {
    return { sessionName, status: "dead" };
  }
}

// UUID pattern for agent-os managed sessions: claude-{uuid}
const UUID_PATTERN = /^claude-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET() {
  try {
    const sessions = await getTmuxSessions();

    // Get status for agent-os managed sessions (claude-{uuid} pattern)
    const managedSessions = sessions.filter(s => UUID_PATTERN.test(s));
    const statuses = await Promise.all(
      managedSessions.map(s => getSessionStatus(s))
    );

    // Create a map of session ID to status
    const statusMap: Record<string, SessionStatus> = {};
    for (const status of statuses) {
      // Extract session ID from "claude-{id}"
      const id = status.sessionName.replace("claude-", "");
      statusMap[id] = status;
    }

    // Get other tmux sessions (not managed by agent-os)
    const otherSessions = sessions.filter(s => !UUID_PATTERN.test(s));
    const otherStatuses = await Promise.all(
      otherSessions.map(s => getSessionStatus(s))
    );

    return NextResponse.json({
      statuses: statusMap,
      otherSessions: otherStatuses
    });
  } catch (error) {
    console.error("Error getting session statuses:", error);
    return NextResponse.json({ statuses: {}, otherSessions: [] });
  }
}
