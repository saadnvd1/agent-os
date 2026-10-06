/**
 * Live chat conversations, one per session, for any driver. Keeps items in
 * SQLite, streams them to whoever is watching, and closes idle conversations
 * (the next message resumes them by the agent's own session id).
 */

import os from "os";
import { db, type Session } from "../db";
import { agentEnv } from "../agents/launch";
import { BUS_BRIEF } from "../agents/brief";
import { chatDriverFor } from "./drivers";
import type {
  ApprovalDecision,
  ChatImage,
  ChatState,
  UndoPreview,
} from "./events";
import {
  emit,
  getSession,
  record,
  registry,
  type Listener,
  type Live,
} from "./registry";
import {
  capsKey,
  chatModel,
  emitCapabilities,
  sendCapabilities,
} from "./settings";
import { listItems, settle } from "./store";

export { setChatAccess, setChatModel } from "./settings";

const IDLE_CLOSE_MS = 30 * 60 * 1000;

function setState(sessionId: string, live: Live, state: ChatState): void {
  live.state = state;
  emit(sessionId, { type: "state", state });
  clearTimeout(live.idleTimer);
  if (state === "idle") {
    live.idleTimer = setTimeout(() => stopChat(sessionId), IDLE_CLOSE_MS);
  }
}

async function pump(sessionId: string, live: Live): Promise<void> {
  try {
    for await (const e of live.conversation.events) {
      if (e.type === "item") {
        if ("streaming" in e.item && e.item.streaming)
          live.streaming.set(e.item.id, e.item);
        else live.streaming.delete(e.item.id);
        record(sessionId, e.item);
      } else if (e.type === "delta") {
        const item = live.streaming.get(e.id);
        if (item && "text" in item) item.text += e.text;
        emit(sessionId, { type: "delta", id: e.id, text: e.text });
      } else if (e.type === "resume_id") {
        // The agent's own conversation id, so the terminal can resume it too.
        // An undo's resume point is used up once the conversation is back.
        db.prepare(
          `UPDATE sessions SET claude_session_id = ?, chat_resume_at = NULL WHERE id = ?`
        ).run(e.id, sessionId);
      } else if (e.type === "state") {
        // A stopped turn can still settle an approval after it ended.
        if (e.state !== "running" || live.state !== "idle")
          setState(sessionId, live, e.state);
      } else if (e.type === "commands" || e.type === "terminal_only") {
        const session = getSession(sessionId);
        const caps = registry.caps.get(capsKey(session));
        if (caps) {
          if (e.type === "commands") caps.commands = e.commands;
          else e.names.forEach((n) => caps.terminalOnly.add(n));
          emitCapabilities(session);
        }
      }
    }
  } catch (error) {
    record(sessionId, {
      id: `error-${Date.now()}`,
      kind: "error",
      message: error instanceof Error ? error.message : String(error),
      createdAt: Date.now(),
    });
  } finally {
    for (const item of live.streaming.values())
      record(sessionId, settle([item])[0]);
    if (registry.live.get(sessionId) === live) registry.live.delete(sessionId);
    clearTimeout(live.idleTimer);
    emit(sessionId, { type: "state", state: "idle" });
  }
}

function ensureLive(session: Session): Live {
  const existing = registry.live.get(session.id);
  if (existing) return existing;
  const driver = chatDriverFor(session.agent_type);
  if (!driver)
    throw new Error(`${session.agent_type} sessions can't run as chat yet`);
  if (session.host_id && session.host_id !== "local") {
    throw new Error("Chat runs on this machine only for now");
  }
  const conversation = driver.start({
    cwd: session.working_directory.replace(/^~/, os.homedir()),
    model: chatModel(session),
    resumeId: session.claude_session_id,
    resumeAt: session.chat_resume_at,
    access: session.chat_access ?? "full",
    systemAppend: BUS_BRIEF,
    env: agentEnv(session.id),
  });
  const live: Live = { conversation, state: "idle", streaming: new Map() };
  registry.live.set(session.id, live);
  void pump(session.id, live);
  return live;
}

export function sendChat(
  sessionId: string,
  input: { text: string; images?: ChatImage[]; from?: string }
): void {
  const text = input.text.trim();
  if (!text && !input.images?.length) return;
  const live = ensureLive(getSession(sessionId));
  const checkpoint = live.conversation.send(text, input.images);
  record(sessionId, {
    id: `user-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    kind: "user",
    text,
    images: input.images,
    from: input.from,
    checkpoint,
    createdAt: Date.now(),
  });
  setState(sessionId, live, "running");
  db.prepare(
    `UPDATE sessions SET updated_at = datetime('now') WHERE id = ?`
  ).run(sessionId);
}

export function respondChat(
  sessionId: string,
  id: string,
  answer: ApprovalDecision
): void {
  registry.live.get(sessionId)?.conversation.respond(id, answer);
}

// Puts files back as they were before a message, and continues the
// conversation from just before it. A dry run only says what would change.
export async function undoChat(
  sessionId: string,
  from: string,
  dryRun: boolean,
  reply: Listener
): Promise<void> {
  const target = listItems(sessionId).find((i) => i.id === from);
  if (target?.kind !== "user" || !target.checkpoint)
    throw new Error("That message can't be undone");
  const running = registry.live.get(sessionId)?.state;
  if (running === "running" || running === "waiting")
    throw new Error("Stop the agent before undoing");
  const live = ensureLive(getSession(sessionId));
  const result = await live.conversation.undo(target.checkpoint, dryRun);
  const preview: UndoPreview = {
    canUndo: result.canUndo,
    error: result.error,
    files: result.files,
    insertions: result.insertions,
    deletions: result.deletions,
  };
  if (dryRun || !result.canUndo) {
    reply({ type: "undo_preview", from, preview });
    return;
  }
  record(sessionId, {
    id: `undo-${Date.now()}`,
    kind: "undo",
    from,
    filesChanged: result.files.length,
    insertions: result.insertions,
    deletions: result.deletions,
    createdAt: Date.now(),
  });
  if (result.resumeAt !== undefined) {
    // The next message starts the conversation again from before this one.
    stopChat(sessionId);
    if (result.resumeAt === null)
      db.prepare(
        `UPDATE sessions SET claude_session_id = NULL, chat_resume_at = NULL WHERE id = ?`
      ).run(sessionId);
    else
      db.prepare(`UPDATE sessions SET chat_resume_at = ? WHERE id = ?`).run(
        result.resumeAt,
        sessionId
      );
  }
  reply({ type: "undone", from, text: target.text });
}

export async function interruptChat(sessionId: string): Promise<void> {
  await registry.live.get(sessionId)?.conversation.interrupt();
}

export function stopChat(sessionId: string): void {
  const live = registry.live.get(sessionId);
  if (!live) return;
  registry.live.delete(sessionId);
  live.conversation.close();
}

export function chatState(sessionId: string): ChatState | null {
  return registry.live.get(sessionId)?.state ?? null;
}

// Snapshot then live updates. Returns the unsubscribe function.
export function watchChat(sessionId: string, listener: Listener): () => void {
  const live = registry.live.get(sessionId);
  let items = listItems(sessionId);
  if (live) {
    // Streaming items carry their latest text in memory, not yet in SQLite.
    items = items.map((i) => live.streaming.get(i.id) ?? i);
  } else {
    items = settle(items);
  }
  listener({ type: "snapshot", items, state: live?.state ?? "idle" });
  void sendCapabilities(sessionId, listener);
  let set = registry.listeners.get(sessionId);
  if (!set) registry.listeners.set(sessionId, (set = new Set()));
  set.add(listener);
  return () => set?.delete(listener);
}
