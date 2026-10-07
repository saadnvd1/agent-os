/**
 * Chat conversations as the server sees them. Each runs in its own worker
 * process (lib/chat/worker) that owns the agent and writes to SQLite; the
 * server starts or reattaches to it, forwards commands, and streams its
 * events to whoever is watching. Restarting the server leaves turns running.
 */

import { randomUUID } from "crypto";
import os from "os";
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
import {
  deleteQueued,
  editQueued,
  listQueue,
  moveQueued,
  queuedSessions,
} from "./queued";
import { fallbackFileSuggestions } from "./files";
import type { FileSuggestion } from "./events";
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

// Leaves plan mode and starts the plan. The message's id comes from the
// plan, so a second tap or a retry is the same message, which the worker
// runs once; the card shows it carried out only once the worker has it.
export async function carryOutPlan(
  sessionId: string,
  planId: string,
  timeoutMs?: number
): Promise<void> {
  const item = listItems(sessionId).find((i) => i.id === planId);
  if (item?.kind !== "plan") throw new Error("That plan is gone");
  if (item.carried) return;
  // Mid-turn (another tab, a phone reconnecting), leaving plan mode would let
  // the turn still planning start changing things. Asked of the worker
  // itself: just after a restart nothing is attached yet.
  const { state } = await ensureLive(sessionId);
  if (state === "running" || state === "waiting")
    throw new Error("The plan can be carried out once this turn ends");
  await setChatPlan(sessionId, false);
  await sendChatConfirmed(
    sessionId,
    { id: `user-carry-${planId}`, text: CARRY_OUT },
    timeoutMs
  );
  const carried = { ...item, carried: true };
  saveItem(sessionId, carried);
  emit(sessionId, { type: "item", item: carried });
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
    // Its turn ended on code from before a redeploy: close it now. Its
    // queue is empty unless its agent died mid-turn; a current worker then
    // takes what's left.
    if (isStaleWorker(live.build, buildId(), e.state)) {
      stopChat(sessionId);
      void resumeQueue(sessionId);
    }
  } else if (e.type === "suggestion") {
    emit(sessionId, e);
  } else if (e.type === "queue") {
    emitQueue(sessionId);
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

function emitQueue(sessionId: string): void {
  emit(sessionId, { type: "queue", queue: listQueue(sessionId) });
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
      onClose: (detached: boolean) => {
        if (live && registry.live.get(sessionId) === live) {
          registry.live.delete(sessionId);
          emit(sessionId, { type: "state", state: "idle" });
        }
        // Its agent died mid-turn, with messages still queued. (One this
        // server let go, it stopped on purpose.)
        if (live && !detached) void resumeQueue(sessionId);
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
      canPlan: !!hello.caps?.includes("plan"),
      canQueue: !!hello.caps?.includes("queue"),
    };
    registry.live.set(sessionId, live);
    // A setting changed while no worker was attached (a restart, a dropped
    // socket) reaches it now; both are safe to repeat.
    const saved = getSession(sessionId);
    client.command({ type: "set_access", access: saved.chat_access });
    if (live.canPlan)
      client.command({ type: "set_plan", plan: !!saved.chat_plan });
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
    // Typed in the composer: waits in the queue while a turn runs.
    queue?: boolean;
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
    queue: input.queue,
  });
}

// The queue lives in SQLite, so it can be changed with no worker running;
// a worker reads it only when it sends the next message.
export function editQueuedChat(sessionId: string, id: string, text: string) {
  if (text.trim()) editQueued(sessionId, id, text.trim());
  else deleteQueued(sessionId, id);
  emitQueue(sessionId);
}

export function moveQueuedChat(sessionId: string, id: string, by: -1 | 1) {
  moveQueued(sessionId, id, by);
  emitQueue(sessionId);
}

export function deleteQueuedChat(sessionId: string, id: string) {
  deleteQueued(sessionId, id);
  emitQueue(sessionId);
}

// A queue no worker is left to send (it was retired, or its agent died):
// a fresh worker sends it in order. Never interrupts: a worker that's busy
// sends its queue when its turn ends. At most once a minute per
// conversation, so a worker that can't start isn't restarted in a loop.
const RESUME_EVERY_MS = 60_000;
const RESUME_WITHIN_MS = 60 * 60 * 1000;
const resumed = new Map<string, number>();
async function resumeQueue(sessionId: string): Promise<void> {
  if (!listQueue(sessionId).length) return;
  // Switched to the terminal: its agent runs there now, and a chat worker
  // on the same conversation would race it. The queue waits on screen.
  const session = db
    .prepare(`SELECT view, archived_at FROM sessions WHERE id = ?`)
    .get(sessionId) as { view: string; archived_at: string | null } | undefined;
  if (session?.view !== "chat" || session.archived_at) return;
  const last = resumed.get(sessionId) ?? 0;
  if (Date.now() - last < RESUME_EVERY_MS) return;
  resumed.set(sessionId, Date.now());
  try {
    const live = await ensureLive(sessionId);
    if (live.canQueue) live.worker.command({ type: "drain" });
  } catch (error) {
    console.error(
      `Not sending ${sessionId}'s queue:`,
      error instanceof Error ? error.message : error
    );
  }
}

// Sends a queued message now: a running turn stops for it, as on Esc.
// `during`: the user message whose turn the reader saw running, so a turn
// that started since (the next queued one) isn't the one stopped.
export async function sendQueuedNow(
  sessionId: string,
  id: string,
  during?: string
) {
  if (!listQueue(sessionId).some((m) => m.id === id)) return;
  const live = await ensureLive(sessionId);
  if (!live.canQueue)
    throw new Error("Reload to send this: the chat is on an older version");
  live.worker.command({ type: "send_now", id, during });
}

// Files and folders for an @mention: the agent's own matching when its
// worker is up and has an answer, ripgrep over the folder otherwise.
export async function chatFileSuggestions(
  sessionId: string,
  query: string
): Promise<FileSuggestion[]> {
  const live = registry.live.get(sessionId);
  const fromAgent = live?.canQueue
    ? await live.worker.fileSuggestions(query)
    : null;
  // Empty while its file index warms up, the first seconds of a worker.
  if (fromAgent?.length) return fromAgent;
  const cwd = getSession(sessionId).working_directory.replace(
    /^~/,
    os.homedir()
  );
  return fallbackFileSuggestions(cwd, query);
}

// Sends, then waits for the worker to record the message as a user item:
// only then has it accepted it. "queued" when a turn was already running.
export async function sendChatConfirmed(
  sessionId: string,
  input: { text: string; from?: string; peer?: PeerMessage; id?: string },
  timeoutMs = 10_000
): Promise<"delivered" | "queued"> {
  const text = input.text.trim();
  if (!text) throw new Error("Message is empty");
  const live = await ensureLive(sessionId);
  const wasBusy = live.state === "running" || live.state === "waiting";
  const id = input.id ?? `user-${Date.now()}-${randomUUID().slice(0, 5)}`;
  // Already taken (a retry of the same message): nothing to wait for.
  if (input.id && listItems(sessionId).some((i) => i.id === id))
    return "delivered";
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

// The state of a chat whose worker may still be running from before a
// restart: connects to that worker (never starts one) to ask. Null when no
// worker runs; throws when one runs but can't be reached.
export async function chatStateNow(
  sessionId: string
): Promise<ChatState | null> {
  const known = chatState(sessionId);
  if (known) return known;
  if (!runningWorkers().includes(sessionId)) return null;
  return (await ensureLive(sessionId, false)).state;
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
  listener({
    type: "snapshot",
    items,
    state: live?.state ?? "idle",
    queue: listQueue(sessionId),
    suggestion: getSession(sessionId).chat_suggestion ?? null,
  });
  listener({ type: "context", context: savedContext(sessionId) });
  void sendCapabilities(sessionId, listener);
  let set = registry.listeners.get(sessionId);
  if (!set) registry.listeners.set(sessionId, (set = new Set()));
  set.add(listener);
  return () => set?.delete(listener);
}

// After a restart: reconnect to every worker still running a conversation,
// and send the queues of conversations whose worker is gone.
export async function reattachChats(): Promise<void> {
  const running = runningWorkers();
  await Promise.all(
    running.map((id) =>
      ensureLive(id, false).catch((error) =>
        console.error(`Not reattaching chat ${id}:`, error.message ?? error)
      )
    )
  );
  // One at a time, and only what was queued recently: a backlog from long
  // ago isn't sent unasked by a restart (it stays on screen to send).
  for (const id of queuedSessions(Date.now() - RESUME_WITHIN_MS))
    if (!running.includes(id)) await resumeQueue(id);
}
