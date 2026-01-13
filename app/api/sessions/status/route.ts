import { NextResponse } from "next/server";
import { exec } from "child_process";
import { promisify } from "util";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { statusDetector, type SessionStatus } from "@/lib/status-detector";
import type { AgentType } from "@/lib/providers";
import {
  getManagedSessionPattern,
  getProviderIdFromSessionName,
  getSessionIdFromName,
} from "@/lib/providers/registry";
import { getDb } from "@/lib/db";

const execAsync = promisify(exec);

interface SessionStatusResponse {
  sessionName: string;
  status: SessionStatus;
  lastLine?: string;
  claudeSessionId?: string | null;
  agentType?: AgentType;
}

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

// Get Claude session ID by looking at session files on disk
function getClaudeSessionIdFromFiles(projectPath: string): string | null {
  const home = os.homedir();
  const claudeDir = process.env.CLAUDE_CONFIG_DIR || path.join(home, ".claude");
  const projectDirName = projectPath.replace(/\//g, "-");
  const projectDir = path.join(claudeDir, "projects", projectDirName);

  if (!fs.existsSync(projectDir)) {
    return null;
  }

  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jsonl$/;

  try {
    const files = fs.readdirSync(projectDir);
    let mostRecent: string | null = null;
    let mostRecentTime = 0;

    for (const file of files) {
      if (file.startsWith("agent-")) continue;
      if (!uuidPattern.test(file)) continue;

      const filePath = path.join(projectDir, file);
      const stat = fs.statSync(filePath);

      if (stat.mtimeMs > mostRecentTime) {
        mostRecentTime = stat.mtimeMs;
        mostRecent = file.replace(".jsonl", "");
      }
    }

    if (mostRecent && Date.now() - mostRecentTime < 5 * 60 * 1000) {
      return mostRecent;
    }

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

async function getClaudeSessionId(sessionName: string): Promise<string | null> {
  const envId = await getClaudeSessionIdFromEnv(sessionName);
  if (envId) {
    return envId;
  }

  const cwd = await getTmuxSessionCwd(sessionName);
  if (cwd) {
    return getClaudeSessionIdFromFiles(cwd);
  }

  return null;
}

async function getLastLine(sessionName: string): Promise<string> {
  try {
    const { stdout } = await execAsync(
      `tmux capture-pane -t "${sessionName}" -p -S -5 2>/dev/null || echo ""`
    );
    const lines = stdout.trim().split("\n").filter(Boolean);
    return lines.pop() || "";
  } catch {
    return "";
  }
}

// UUID pattern for agent-os managed sessions (derived from registry)
const UUID_PATTERN = getManagedSessionPattern();

// Track previous statuses to detect changes
const previousStatuses = new Map<string, SessionStatus>();

function getAgentTypeFromSessionName(sessionName: string): AgentType {
  return getProviderIdFromSessionName(sessionName) || "claude";
}

export async function GET() {
  try {
    const sessions = await getTmuxSessions();

    // Get status for agent-os managed sessions
    const managedSessions = sessions.filter(s => UUID_PATTERN.test(s));

    // Use the new status detector
    const statusMap: Record<string, SessionStatusResponse> = {};

    const db = getDb();
    const sessionsToUpdate: string[] = [];

    for (const sessionName of managedSessions) {
      const status = await statusDetector.getStatus(sessionName);
      const claudeSessionId = await getClaudeSessionId(sessionName);
      const lastLine = await getLastLine(sessionName);
      const id = getSessionIdFromName(sessionName);
      const agentType = getAgentTypeFromSessionName(sessionName);

      // Track status changes - update DB when session becomes active
      const prevStatus = previousStatuses.get(id);
      if (status === "running" || status === "waiting") {
        if (prevStatus !== status) {
          sessionsToUpdate.push(id);
        }
      }
      previousStatuses.set(id, status);

      statusMap[id] = {
        sessionName,
        status,
        lastLine,
        claudeSessionId,
        agentType,
      };
    }

    // Batch update sessions that became active (updates updated_at for sorting)
    if (sessionsToUpdate.length > 0) {
      const updateStmt = db.prepare("UPDATE sessions SET updated_at = datetime('now') WHERE id = ?");
      for (const id of sessionsToUpdate) {
        updateStmt.run(id);
      }
    }

    // Cleanup old trackers
    statusDetector.cleanup();

    return NextResponse.json({ statuses: statusMap });
  } catch (error) {
    console.error("Error getting session statuses:", error);
    return NextResponse.json({ statuses: {} });
  }
}
