/**
 * What a chat agent offers in a folder (commands, skills, models) and the
 * per-session settings that go with them: the model and the access level.
 */

import os from "os";
import { db, type Session } from "../db";
import { agentEnv } from "../agents/launch";
import { resolveModelForAgent } from "../model-catalog";
import { chatDriverFor } from "./drivers";
import {
  CHAT_ACCESS,
  type ChatAccess,
  type ChatCommand,
  type ChatServerMessage,
} from "./events";
import {
  emit,
  getSession,
  registry,
  type Capabilities,
  type Listener,
} from "./registry";

const CAPS_TTL_MS = 10 * 60 * 1000;

// Commands that only make sense in a terminal UI, hidden from chat when the
// agent doesn't say so itself.
const TERMINAL_ONLY = new Set([
  "exit",
  "quit",
  "statusline",
  "terminal-setup",
  "vim",
  "color",
  "theme",
  "ide",
  "heapdump",
  "config",
  "resume",
  "login",
  "logout",
]);

export const capsKey = (s: Session) => `${s.agent_type}:${s.working_directory}`;

// The session's own model when it has one; the agent's default otherwise.
export function chatModel(session: Session): string {
  return (
    session.model?.trim() || resolveModelForAgent(session.agent_type, null)
  );
}

function visibleCommands(caps: Capabilities): ChatCommand[] {
  return caps.commands.filter(
    (c) =>
      !c.name.startsWith("__") &&
      !caps.terminalOnly.has(c.name) &&
      !TERMINAL_ONLY.has(c.name)
  );
}

export function emitCapabilities(session: Session, listener?: Listener): void {
  const caps = registry.caps.get(capsKey(session));
  if (!caps) return;
  const m: ChatServerMessage = {
    type: "capabilities",
    commands: visibleCommands(caps),
    models: caps.models,
    model: chatModel(session),
    access: session.chat_access,
    plan: canPlan(session) ? !!session.chat_plan : null,
  };
  if (listener) listener(m);
  else emit(session.id, m);
}

async function loadCapabilities(session: Session): Promise<void> {
  const key = capsKey(session);
  const cached = registry.caps.get(key);
  if (cached && Date.now() - cached.at < CAPS_TTL_MS) return;
  const driver = chatDriverFor(session.agent_type);
  if (!driver) return;
  const found = await driver.discover({
    cwd: session.working_directory.replace(/^~/, os.homedir()),
    env: agentEnv(session.id),
  });
  registry.caps.set(key, {
    ...found,
    terminalOnly: cached?.terminalOnly ?? new Set(),
    at: Date.now(),
  });
}

// Sends what the agent offers to one watcher, loading it if needed.
export async function sendCapabilities(
  sessionId: string,
  listener: Listener
): Promise<void> {
  let session: Session;
  try {
    // Gone since the socket opened: nothing to say, and nothing to throw.
    session = getSession(sessionId);
  } catch {
    return;
  }
  if (session.host_id && session.host_id !== "local") return;
  try {
    await loadCapabilities(session);
  } catch (error) {
    console.error("Could not load chat commands:", error);
  }
  emitCapabilities(session, listener);
}

// Switches the model now if a conversation is live, and for every next start.
export async function setChatModel(
  sessionId: string,
  model: string
): Promise<void> {
  const value = model.trim();
  if (!value) return;
  db.prepare(`UPDATE sessions SET model = ? WHERE id = ?`).run(
    value,
    sessionId
  );
  registry.live
    .get(sessionId)
    ?.worker.command({ type: "set_model", model: value });
  emitCapabilities(getSession(sessionId));
}

// Changes what the agent may do without asking, now and for every next start.
export async function setChatAccess(
  sessionId: string,
  access: ChatAccess
): Promise<void> {
  if (!CHAT_ACCESS.includes(access)) return;
  // An orchestrator's access is fixed by its role.
  if (getSession(sessionId).role === "orchestrator") return;
  db.prepare(`UPDATE sessions SET chat_access = ? WHERE id = ?`).run(
    access,
    sessionId
  );
  registry.live.get(sessionId)?.worker.command({ type: "set_access", access });
  emitCapabilities(getSession(sessionId));
}

// An orchestrator's permission mode is fixed by its role.
const canPlan = (s: Session) =>
  s.role !== "orchestrator" && chatDriverFor(s.agent_type)?.plan !== false;

// Plan mode: the agent reads and plans, and changes nothing until the plan
// is carried out. Now if a conversation is live, and for every next start.
export async function setChatPlan(
  sessionId: string,
  plan: boolean
): Promise<void> {
  if (!canPlan(getSession(sessionId))) return;
  const live = registry.live.get(sessionId);
  if (live && !live.canPlan) {
    // A worker from an older build would drop the switch: it's retired when
    // its turn ends, and the next one starts in the saved mode.
    emitCapabilities(getSession(sessionId));
    if (live.state === "running" || live.state === "waiting")
      throw new Error(
        "Plan mode can change once this turn ends: the agent is still on the previous build"
      );
    registry.live.delete(sessionId);
    live.worker.command({ type: "close" });
    live.worker.detach();
  }
  db.prepare(`UPDATE sessions SET chat_plan = ? WHERE id = ?`).run(
    plan ? 1 : 0,
    sessionId
  );
  registry.live.get(sessionId)?.worker.command({ type: "set_plan", plan });
  emitCapabilities(getSession(sessionId));
}
