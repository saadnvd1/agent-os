// The status of every session for the sidebar: terminals read from their
// program's own reports (OSC 7501) or, failing that, their screen; chats
// from their live conversation. Shared by GET /api/sessions/status and the
// pushed /ws/status stream.
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { managedPanes } from "./managed";
import {
  findQuestion,
  plainText,
  readInputBox,
  statusDetector,
  type SessionStatus,
} from "../status-detector";
import type { AgentType } from "../providers";
import {
  getManagedSessionPattern,
  getProviderIdFromSessionName,
  getSessionIdFromName,
} from "../providers/registry";
import { getDb, type Session } from "../db";
import { chatState } from "../chat/runner";
import { chatActivityLine } from "../chat/activity";
import {
  chatNeed,
  isUnread,
  needsYou,
  programStatusRow,
  terminalStatus,
} from "../needs-you";
import type { SessionNeed } from "../sidebar/shelves";
import { openAskCount } from "../orchestrator/asks";
import { lastUserTask } from "../chat/store";
import { hostExecFile, isRemoteHost } from "../hosts";
import {
  applyProgramReport,
  dropProgramTransient,
  programSummary,
} from "../program-status/store";
import type { ProgramSummary } from "../program-status/records";

// tmux run directly, no shell; a failure reads as empty output.
const tmuxOn = (sessionName: string, args: string[]) =>
  hostExecFile(statusDetector.hostFor(sessionName), "tmux", args).catch(() => ({
    stdout: "",
  }));

export interface SessionStatusResponse {
  sessionName: string;
  status: SessionStatus | "error";
  lastLine?: string;
  claudeSessionId?: string | null;
  agentType?: AgentType;
  title?: string;
  task?: string | null;
  // An orchestrator's open asks: each counts as one thing needing you.
  asks?: number;
  need?: SessionNeed | null;
  unread?: boolean;
  // A program's own message (OSC 7501): untrusted, plain text only.
  detail?: string | null;
  progress?: number | null;
}

export interface StatusSnapshot {
  statuses: Record<string, SessionStatusResponse>;
  hostErrors: Record<string, string>;
}

async function getTmuxSessions(): Promise<string[]> {
  const sessions = await statusDetector.listSessions();
  return sessions.map((s) => s.name);
}

async function getTmuxSessionCwd(sessionName: string): Promise<string | null> {
  try {
    const { stdout } = await tmuxOn(sessionName, [
      "display-message",
      "-t",
      sessionName,
      "-p",
      "#{pane_current_path}",
    ]);
    const cwd = stdout.trim();
    return cwd || null;
  } catch {
    return null;
  }
}

// Get Claude session ID from tmux environment variable
async function getClaudeSessionIdFromEnv(
  sessionName: string
): Promise<string | null> {
  try {
    const { stdout } = await tmuxOn(sessionName, [
      "show-environment",
      "-t",
      sessionName,
      "CLAUDE_SESSION_ID",
    ]);
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

  const uuidPattern =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jsonl$/;

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

// It rarely changes, and finding it reads a directory: once a minute is plenty.
const claudeIds = new Map<string, { id: string | null; at: number }>();
const CLAUDE_ID_MS = 60000;

async function getClaudeSessionId(sessionName: string): Promise<string | null> {
  const cached = claudeIds.get(sessionName);
  if (cached && Date.now() - cached.at < CLAUDE_ID_MS) return cached.id;
  const id = await findClaudeSessionId(sessionName);
  claudeIds.set(sessionName, { id, at: Date.now() });
  return id;
}

async function findClaudeSessionId(
  sessionName: string
): Promise<string | null> {
  const envId = await getClaudeSessionIdFromEnv(sessionName);
  if (envId) {
    return envId;
  }

  // Claude's transcript files live on the machine running the session.
  if (isRemoteHost(statusDetector.hostFor(sessionName))) return null;

  const cwd = await getTmuxSessionCwd(sessionName);
  if (cwd) {
    return getClaudeSessionIdFromFiles(cwd);
  }

  return null;
}

// The screen's last line of text.
const lastLineOf = (screen: string) =>
  plainText(screen).trim().split("\n").filter(Boolean).pop() || "";

// UUID pattern for agent-os managed sessions (derived from registry)
const UUID_PATTERN = getManagedSessionPattern();

// Track previous statuses to detect changes
const previousStatuses = new Map<string, SessionStatus>();
// What each terminal's screen last needed from you, to move updated_at once.
const previousScreenNeeds = new Map<string, string>();
// A terminal read from its screen was running at the last look: its
// cooldown ends with no output to say so.
let heuristicBusy = false;

// Esc on a Claude Code question fires no hook, so its blocked report
// outlives the menu. Its input box back with no menu means it's gone. The
// grace covers the moment before the menu is drawn.
const QUESTION_GRACE_MS = 3000;
export function questionDismissed(
  program: ProgramSummary | null,
  screen: string,
  now = Date.now()
): boolean {
  return (
    program?.state === "blocked" &&
    program.kind === "question" &&
    program.app === "claude-code" &&
    now - program.at > QUESTION_GRACE_MS &&
    findQuestion(screen) === null &&
    readInputBox(screen) !== null
  );
}

function getAgentTypeFromSessionName(sessionName: string): AgentType {
  return getProviderIdFromSessionName(sessionName) || "claude";
}

function terminalRow(db: ReturnType<typeof getDb>, id: string) {
  return db
    .prepare(
      `SELECT id, view, updated_at, last_seen_at FROM sessions WHERE id = ?`
    )
    .get(id) as
    | Pick<Session, "id" | "view" | "updated_at" | "last_seen_at">
    | undefined;
}

async function collect(): Promise<StatusSnapshot> {
  const sessions = await getTmuxSessions();

  const db = getDb();
  const panes = managedPanes(
    sessions,
    db
      .prepare(
        `SELECT id, tmux_name, agent_type FROM sessions WHERE archived_at IS NULL AND (view IS NULL OR view != 'chat')`
      )
      .all() as {
      id: string;
      tmux_name: string | null;
      agent_type: string | null;
    }[],
    (name) => UUID_PATTERN.test(name),
    getSessionIdFromName
  );
  const paneOf = new Map(panes.map((p) => [p.name, p]));
  const managedSessions = panes.map((p) => p.name);

  const statusMap: Record<string, SessionStatusResponse> = {};
  const sessionsToUpdate: string[] = [];

  // Process all sessions in parallel for speed
  const sessionPromises = managedSessions.map(async (sessionName) => {
    // Working and blocked end with the program that reported them.
    const fg = statusDetector.foregroundFor(sessionName);
    if (fg) dropProgramTransient(sessionName, fg, statusDetector.listedAt());
    let program = programSummary(sessionName);
    // A reported question is checked against the screen as it is now.
    const [screen, claudeSessionId] = await Promise.all([
      statusDetector.captureScreen(sessionName, program?.state === "blocked"),
      getClaudeSessionId(sessionName),
    ]);
    if (questionDismissed(program, screen)) {
      applyProgramReport(sessionName, {
        state: "idle",
        id: "",
        app: program?.app,
      });
      program = programSummary(sessionName);
    }
    const status = program
      ? null
      : await statusDetector.getStatus(sessionName, screen);
    // A program that reports working or blocked knows better than its
    // screen; its own questions come as blocked reports.
    const busy =
      program?.state === "working" ||
      program?.state === "blocked" ||
      status === "running";
    // Text typed before a send isn't unsent: forget it while it works.
    if (busy) statusDetector.clearUnsent(sessionName);
    const screenNeed = busy
      ? null
      : statusDetector.screenNeed(sessionName, screen, { question: !program });
    const pane = paneOf.get(sessionName);
    const id = pane?.id ?? getSessionIdFromName(sessionName);
    const agentType =
      pane?.agentType ?? getAgentTypeFromSessionName(sessionName);

    return {
      sessionName,
      id,
      status,
      program,
      screenNeed,
      claudeSessionId,
      lastLine: lastLineOf(screen),
      agentType,
    };
  });

  const results = await Promise.all(sessionPromises);
  heuristicBusy = results.some((r) => r.status === "running");

  for (const {
    sessionName,
    id,
    status,
    program,
    screenNeed,
    claudeSessionId,
    lastLine,
    agentType,
  } of results) {
    const row = terminalRow(db, id);
    const shared = {
      sessionName,
      lastLine,
      claudeSessionId,
      agentType,
      title: statusDetector.titleFor(sessionName),
    };
    // A question on screen, or a message typed and never sent: it needs you
    // whether or not you've seen it, like a blocked program.
    const needKey = screenNeed ? `${screenNeed.need}:${screenNeed.detail}` : "";
    if (needKey && previousScreenNeeds.get(id) !== needKey)
      sessionsToUpdate.push(id);
    if (needKey) previousScreenNeeds.set(id, needKey);
    else previousScreenNeeds.delete(id);
    if (screenNeed) {
      if (!program) previousStatuses.set(id, "waiting");
      statusMap[id] = {
        ...shared,
        status: "waiting",
        need: screenNeed.need,
        unread: false,
        detail: screenNeed.detail,
      };
      continue;
    }
    // A program reporting its own state (OSC 7501) beats reading the screen.
    if (program || !status) {
      previousStatuses.delete(id);
      if (program)
        statusMap[id] = { ...shared, ...programStatusRow(row, program) };
      continue;
    }
    // Track status changes - update DB when session becomes active
    const prevStatus = previousStatuses.get(id);
    if (status === "running" || status === "waiting") {
      if (prevStatus !== status) {
        sessionsToUpdate.push(id);
      }
    }
    previousStatuses.set(id, status);

    statusMap[id] = { ...shared, ...terminalStatus(row, status) };
  }

  // Batch update sessions and claude_session_id in a single transaction
  const updateStatusStmt = db.prepare(
    "UPDATE sessions SET updated_at = datetime('now') WHERE id = ?"
  );
  const updateClaudeIdStmt = db.prepare(
    "UPDATE sessions SET claude_session_id = ? WHERE id = ? AND (claude_session_id IS NULL OR claude_session_id != ?)"
  );

  for (const id of sessionsToUpdate) {
    updateStatusStmt.run(id);
  }

  // Update claude_session_id directly here instead of requiring separate API calls
  for (const { id, claudeSessionId } of results) {
    if (claudeSessionId) {
      updateClaudeIdStmt.run(claudeSessionId, id, claudeSessionId);
    }
  }

  // Chat sessions have no tmux pane: their live conversation is the status.
  for (const session of db
    .prepare(
      `SELECT * FROM sessions WHERE view = 'chat' AND archived_at IS NULL`
    )
    .all() as Session[]) {
    const state = chatState(session.id);
    const asks =
      session.role === "orchestrator" ? openAskCount(session.workspace_id) : 0;
    statusMap[session.id] = {
      sessionName: session.tmux_name,
      status:
        state === "running"
          ? "running"
          : needsYou(session, state)
            ? "waiting"
            : "idle",
      task: chatActivityLine(session.id) ?? lastUserTask(session.id),
      agentType: session.agent_type,
      need: chatNeed(session, state, asks),
      unread: session.role !== "orchestrator" && isUnread(session, state),
      ...(session.role === "orchestrator" && { asks }),
    };
  }

  // Cleanup old trackers
  statusDetector.cleanup();

  return { statuses: statusMap, hostErrors: statusDetector.hostErrors() };
}

// Callers at the same moment share one pass over tmux.
let inflight: Promise<StatusSnapshot> | null = null;

export function collectStatuses(): Promise<StatusSnapshot> {
  inflight ??= collect().finally(() => {
    inflight = null;
  });
  return inflight;
}

let lastSignature = "";

/**
 * Whether a terminal may have changed since the last call: "changed" when
 * output, a title or a program did, "busy" when one only still looked busy
 * (its cooldown ends with no output to say so). One list-sessions per
 * machine, cached for two seconds.
 */
export async function terminalsChanged(): Promise<"changed" | "busy" | null> {
  await statusDetector.refreshCache();
  const signature = statusDetector.signature();
  const changed = signature !== lastSignature;
  lastSignature = signature;
  // Typed text that just crossed the unsent threshold changes nothing on
  // screen, so the time alone says to look again.
  return changed || statusDetector.unsentDue()
    ? "changed"
    : heuristicBusy
      ? "busy"
      : null;
}
