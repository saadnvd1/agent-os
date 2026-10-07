/**
 * Chat conversations as the server sees them. Each runs in its own worker
 * process (lib/chat/worker) that owns the agent and writes to SQLite; the
 * server starts or reattaches to it, forwards commands, and streams its
 * events to whoever is watching. Restarting the server leaves turns running.
 */

import { randomUUID } from "crypto";
import { db, type Session } from "../db";
import type {
  ApprovalDecision,
  ChatContext,
  ChatImage,
  ChatState,
  PeerMessage,
  UndoPreview,
} from "./events";
import {
  emit,
  getSession,
  registry,
  type Listener,
  type Live,
} from "./registry";
import {
  capsKey,
  emitCapabilities,
  sendCapabilities,
  setChatPlan,
} from "./settings";
import { listItems, saveItem, settle } from "./store";
import { taskOutputTail } from "./task-output";
import { restoreActivity, track } from "./activity";

export { chatActivity } from "./activity";
import { chatDriverFor } from "./drivers";
import {
  connectWorker,
  removeStaleSocket,
  runningWorkers,
  waitForExit,
} from "./worker/client";
import { buildId, isStaleWorker } from "../build";
import type { WorkerEvent } from "./worker/protocol";

export { setChatAccess, setChatModel, setChatPlan } from "./settings";

function savedContext(sessionId: string): ChatContext | null {
  const raw = getSession(sessionId).chat_context;
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ChatContext;
  } catch {
    return null;
  }
}

const CARRY_OUT = "Carry out the plan.";

// Leaves plan mode and starts the plan, once: the card remembers it.
export async function carryOutPlan(
  sessionId: string,
  planId: string
): Promise<void> {
  const item = listItems(sessionId).find((i) => i.id === planId);
  if (item?.kind !== "plan") throw new Error("That plan is gone");
  if (item.carried) return;
  const carried = { ...item, carried: true };
  saveItem(sessionId, carried);
  emit(sessionId, { type: "item", item: carried });
  await setChatPlan(sessionId, false);
  await sendChat(sessionId, { text: CARRY_OUT });
}

function onWorkerEvent(sessionId: string, live: Live, e: WorkerEvent): void {
  track(live, e);
  if (e.type === "item") {
    if ("streaming" in e.item && e.item.streaming)
      live.streaming.set(e.item.id, e.item);
    else live.streaming.delete(e.item.id);
    emit(sessionId, { type: "item", item: e.item });
  } else if (e.type === "delta") {
    const item = live.streaming.get(e.id);
    if (item && "text" in item) item.text += e.text;
    emit(sessionId, e);
  } else if (e.type === "state") {
    live.state = e.state;
    emit(sessionId, e);
    // Its turn ended on code from before a redeploy: close it now.
    if (isStaleWorker(live.build, buildId(), e.state)) stopChat(sessionId);
  } else if (e.type === "context") {
    emit(sessionId, e);
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

function checkChattable(session: Session): void {
  if (!chatDriverFor(session.agent_type))
    throw new Error(`${session.agent_type} sessions can't run as chat yet`);
  if (session.host_id && session.host_id !== "local")
    throw new Error("Chat runs on this machine only for now");
}

// The session's worker, connected; started first if none is running,
// unless only an existing one will do (reattaching, stopping).
async function ensureLive(sessionId: string, spawn = true): Promise<Live> {
  const existing = registry.live.get(sessionId);
  if (existing) return existing;
  const pending = registry.connecting.get(sessionId);
  if (pending) return pending;
  const connecting = (async () => {
    checkChattable(getSession(sessionId));
    let live: Live | null = null;
    const handlers = {
      onEvent: (e: WorkerEvent) => live && onWorkerEvent(sessionId, live, e),
      onClose: () => {
        if (live && registry.live.get(sessionId) === live) {
          registry.live.delete(sessionId);
          emit(sessionId, { type: "state", state: "idle" });
        }
      },
    };
    let { client, hello } = await connectWorker(sessionId, spawn, handlers);
    // An idle worker left over from before a redeploy: retire it, and start
    // a fresh one only when a message needs it.
    if (isStaleWorker(hello.build, buildId(), hello.state)) {
      client.command({ type: "close" });
      client.detach();
      await waitForExit(sessionId);
      removeStaleSocket(sessionId);
      if (!spawn) throw new Error(`retired a stale worker for ${sessionId}`);
      ({ client, hello } = await connectWorker(sessionId, true, handlers));
    }
    live = {
      worker: client,
      state: hello.state,
      streaming: new Map(hello.streaming.map((i) => [i.id, i])),
      activity: restoreActivity(sessionId, hello.state),
      build: hello.build,
    };
    registry.live.set(sessionId, live);
    emit(sessionId, { type: "state", state: live.state });
    return live;
  })();
  registry.connecting.set(sessionId, connecting);
  try {
    return await connecting;
  } finally {
    registry.connecting.delete(sessionId);
  }
}

export async function sendChat(
  sessionId: string,
  input: {
    text: string;
    images?: ChatImage[];
    from?: string;
    peer?: PeerMessage;
  }
): Promise<void> {
  const text = input.text.trim();
  if (!text && !input.images?.length) return;
  const live = await ensureLive(sessionId);
  live.worker.command({
    type: "send",
    id: `user-${Date.now()}-${randomUUID().slice(0, 5)}`,
    text,
    images: input.images,
    from: input.from,
    peer: input.peer,
  });
}

// Sends, then waits for the worker to record the message as a user item:
// only then has it accepted it. "queued" when a turn was already running.
export async function sendChatConfirmed(
  sessionId: string,
  input: { text: string; from?: string; peer?: PeerMessage },
  timeoutMs = 10_000
): Promise<"delivered" | "queued"> {
  const text = input.text.trim();
  if (!text) throw new Error("Message is empty");
  const live = await ensureLive(sessionId);
  const wasBusy = live.state === "running" || live.state === "waiting";
  const id = `user-${Date.now()}-${randomUUID().slice(0, 5)}`;
  let set = registry.listeners.get(sessionId);
  if (!set) registry.listeners.set(sessionId, (set = new Set()));
  const listeners = set;
  let listener: Listener = () => {};
  let timer: NodeJS.Timeout | undefined;
  const accepted = new Promise<void>((resolve, reject) => {
    listener = (m) => {
      if (m.type === "item" && m.item.id === id) resolve();
    };
    timer = setTimeout(() => {
      // The event can be missed across a reconnect; the row can't.
      if (listItems(sessionId).some((i) => i.id === id)) resolve();
      else
        reject(
          new Error(
            `the chat worker didn't take it within ${timeoutMs / 1000}s`
          )
        );
    }, timeoutMs);
  });
  listeners.add(listener);
  try {
    live.worker.command({
      type: "send",
      id,
      text,
      from: input.from,
      peer: input.peer,
    });
    await accepted;
  } finally {
    clearTimeout(timer);
    listeners.delete(listener);
  }
  return wasBusy ? "queued" : "delivered";
}

export function respondChat(
  sessionId: string,
  id: string,
  answer: ApprovalDecision
): void {
  registry.live
    .get(sessionId)
    ?.worker.command({ type: "respond", id, ...answer });
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
  const live = await ensureLive(sessionId);
  const result = await live.worker.undo(target.checkpoint, dryRun);
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
  const item = {
    id: `undo-${Date.now()}`,
    kind: "undo" as const,
    from,
    filesChanged: result.files.length,
    insertions: result.insertions,
    deletions: result.deletions,
    createdAt: Date.now(),
  };
  saveItem(sessionId, item);
  emit(sessionId, { type: "item", item });
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
  registry.live.get(sessionId)?.worker.command({ type: "interrupt" });
}

// Ends the conversation: its worker closes the agent and exits.
export function stopChat(sessionId: string): void {
  const live = registry.live.get(sessionId);
  if (live) {
    registry.live.delete(sessionId);
    live.worker.command({ type: "close" });
    live.worker.detach();
    return;
  }
  if (runningWorkers().includes(sessionId))
    void ensureLive(sessionId, false)
      .then(() => stopChat(sessionId))
      .catch(() => {});
}

export function chatState(sessionId: string): ChatState | null {
  return registry.live.get(sessionId)?.state ?? null;
}

export function stopChatTask(sessionId: string, taskId: string): void {
  registry.live.get(sessionId)?.worker.command({ type: "stop_task", taskId });
}

export function chatTaskOutput(
  sessionId: string,
  taskId: string
): string | null {
  const task = listItems(sessionId).find(
    (i) => i.kind === "task" && i.taskId === taskId
  );
  if (task?.kind !== "task") return null;
  return taskOutputTail(taskId, task.outputFile);
}

// Snapshot then live updates. Returns the unsubscribe function.
export function watchChat(sessionId: string, listener: Listener): () => void {
  const live = registry.live.get(sessionId);
  let items = listItems(sessionId);
  if (live) {
    items = items.map((i) => live.streaming.get(i.id) ?? i);
  } else if (!runningWorkers().includes(sessionId)) {
    items = settle(items);
  }
  listener({ type: "snapshot", items, state: live?.state ?? "idle" });
  listener({ type: "context", context: savedContext(sessionId) });
  void sendCapabilities(sessionId, listener);
  let set = registry.listeners.get(sessionId);
  if (!set) registry.listeners.set(sessionId, (set = new Set()));
  set.add(listener);
  return () => set?.delete(listener);
}

// After a restart: reconnect to every worker still running a conversation.
export async function reattachChats(): Promise<void> {
  await Promise.all(
    runningWorkers().map((id) =>
      ensureLive(id, false).catch((error) =>
        console.error(`Not reattaching chat ${id}:`, error.message ?? error)
      )
    )
  );
}
