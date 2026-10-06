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
  const session = getSession(sessionId);
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
  await registry.live.get(sessionId)?.conversation.setModel(value);
  emitCapabilities(getSession(sessionId));
}

// Changes what the agent may do without asking, now and for every next start.
export async function setChatAccess(
  sessionId: string,
  access: ChatAccess
): Promise<void> {
  if (!CHAT_ACCESS.includes(access)) return;
  db.prepare(`UPDATE sessions SET chat_access = ? WHERE id = ?`).run(
    access,
    sessionId
  );
  await registry.live.get(sessionId)?.conversation.setAccess(access);
  emitCapabilities(getSession(sessionId));
}
