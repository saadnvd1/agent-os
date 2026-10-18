/**
 * Chat conversations as the server sees them. Each runs in its own worker
 * process (lib/chat/worker) that owns the agent and writes to SQLite; the
 * server starts or reattaches to it, forwards commands, and streams its
 * events to whoever is watching. Restarting the server leaves turns running.
 */

import { pushPlanReady } from "../notify/push/events";
import {
  handoffAfterPlan,
  planTurnStarted,
  recheckPlanning,
  type PlanHandoffEnv,
} from "../models/plan-step";
import { randomUUID } from "crypto";
import os from "os";
import { db, type Session } from "../db";
import type { CompactFirst } from "./stale";
import type {
  ApprovalDecision,
  ChatContext,
  ChatImage,
  ChatServerMessage,
  ChatState,
  Compacting,
  SentBy,
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
  releaseUnwatchedSoon,
  sendCapabilities,
  setChatPlan,
} from "./settings";
import {
  endOrphanedTasks,
  endRunningTasks,
  getItem,
  hasItem,
  itemsOfKind,
  recentTasks,
  sessionsWithRunningTasks,
  saveItem,
  settle,
} from "./store";
import { noteToolResult } from "../health/env/recordHit";
import { readPage, toolBody, type ItemPage } from "./page";
import {
  deleteQueued,
  editQueued,
  enqueue,
  listQueue,
  moveQueued,
  queuedSessions,
} from "./queued";
import {
  fallbackFileSuggestions,
  multiRootFileSuggestions,
  warmFileIndexes,
} from "./files";
import { mentionRoots } from "./mention-roots";
import { REQUESTED_FRESH, releaseConversation } from "./refresh";
import { holdsQueue, settingUp } from "../sessions/setup-progress";
import { firstMessageId, launchPending } from "../tasks/launch-gate";
import type { ChatItem, FileSuggestion } from "./events";
import { taskOutputTail } from "./task-output";
import type { TaskOutput } from "./background";
import { cutOffSessions, cutOffTurn, RESUME_NOTE } from "./interrupted";
import { queueEvent } from "../orchestrator/events";
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
import type { WorkerClient } from "./worker/client";
import { DEMO_REFUSAL, demoMode } from "../security/demo";
import { chatHold, chatRefusal } from "./hold";
import { getHost } from "../hosts";
import { hostLink } from "../hosts/remote-api";

export {
  refreshCapabilities,
  setChatAccess,
  setChatModel,
  setChatPlan,
} from "./settings";

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
  const item = getItem(sessionId, planId);
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
    {
      id: `user-carry-${planId}`,
      text: CARRY_OUT,
      origin: { kind: "decision", label: "Saad" },
    },
    timeoutMs
  );
  const carried = { ...item, carried: true };
  saveItem(sessionId, carried);
  emit(sessionId, { type: "item", item: carried });
}

// Its turn ended on code from before a redeploy: it goes, and the next
// message starts a current worker. Its guess at that message comes a few
// seconds after the turn ends, so it waits for it, unless messages are
// queued (its agent died mid-turn) for a current worker to take. Background
// work (subagents, shells) lives in its agent, so a worker still running
// some stays until the last one ends.
function retireIfStale(sessionId: string, live: Live): void {
  if (
    live.retireSent ||
    live.retiring ||
    !isStaleWorker(live.build, buildId(), live.state)
  )
    return;
  if (listQueue(sessionId).length) retire(sessionId, live);
  else if (!live.activity.tasks.size)
    live.retiring = setTimeout(
      () => retire(sessionId, live),
      SUGGESTION_WAIT_MS
    );
}

// What the plan step needs to know of a chat, read when it asks.
function planEnv(sessionId: string): PlanHandoffEnv {
  return {
    backgroundRunning: () =>
      (registry.live.get(sessionId)?.activity.tasks.size ?? 0) > 0,
    turnRunning: () => {
      const state = registry.live.get(sessionId)?.state;
      return state === "running" || state === "waiting";
    },
  };
}

// Tell watchers of tasks that just ended, and drop them from the live count.
function emitEnded(
  sessionId: string,
  live: Live | undefined,
  ended: ReturnType<typeof endRunningTasks>
): void {
  for (const item of ended) {
    live?.activity.tasks.delete(item.taskId);
    emit(sessionId, { type: "item", item });
  }
}

function onWorkerEvent(sessionId: string, live: Live, e: WorkerEvent): void {
  track(live, e);
  if (e.type === "item" && e.item.kind === "tool")
    noteToolResult(sessionId, e.item);
  if (
    e.type === "item" &&
    e.item.kind === "tool" &&
    (e.item.status === "stopped" || e.item.status === "error")
  )
    emitEnded(sessionId, live, endOrphanedTasks(sessionId));
  if (e.type === "item" && e.item.kind === "task")
    retireIfStale(sessionId, live);
  if (e.type === "item") {
    if (e.item.kind === "plan" && !e.item.carried)
      pushPlanReady(sessionId, e.item.id);
    if ("streaming" in e.item && e.item.streaming)
      live.streaming.set(e.item.id, e.item);
    else live.streaming.delete(e.item.id);
    emit(sessionId, { type: "item", item: e.item });
  } else if (e.type === "delta") {
    const item = live.streaming.get(e.id);
    if (item && "text" in item) item.text += e.text;
    emit(sessionId, e);
  } else if (e.type === "compacting") {
    live.compacting = e.compacting;
    emit(sessionId, e);
  } else if (e.type === "state") {
    live.state = e.state;
    if (e.state === "running") planTurnStarted(sessionId);
    // Whatever ended the turn ended the compaction too.
    if (e.state === "idle" || e.state === "error")
      setCompacting(sessionId, live, null);
    emit(sessionId, e);
    clearTimeout(live.retiring);
    live.retiring = undefined;
    retireIfStale(sessionId, live);
    if (e.state === "idle")
      void handoffAfterPlan(
        sessionId,
        (id, m) => sendQueuedNow(id, m),
        planEnv(sessionId)
      ).catch((err) =>
        console.error(`Plan handoff for ${sessionId} failed:`, err)
      );
  } else if (e.type === "suggestion") {
    emit(sessionId, e);
    if (live.retiring && e.text) retire(sessionId, live);
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

function setCompacting(
  sessionId: string,
  live: Live,
  compacting: Compacting | null
): void {
  if (!live.compacting && !compacting) return;
  live.compacting = compacting;
  emit(sessionId, { type: "compacting", compacting });
}

function emitQueue(sessionId: string): void {
  emit(sessionId, { type: "queue", queue: listQueue(sessionId) });
}

function checkChattable(session: Session): void {
  // A quick change has no agent: a worker would start one in its worktree.
  if (session.quick_of)
    throw new Error(
      "This is a quick change the orchestrator makes itself; it has no agent to chat with"
    );
  if (!chatDriverFor(session.agent_type))
    throw new Error(`${session.agent_type} sessions can't run as chat yet`);
  if (session.host_id && session.host_id !== "local") {
    // A linked machine's AgentOS runs its own chats, and the chat view
    // reaches them through it (./peer-relay). What's sent from here by an
    // agent or a schedule isn't relayed: it would arrive there as yours.
    const name = getHost(session.host_id)?.name ?? "That machine";
    throw new Error(
      hostLink(session.host_id)
        ? `${name}'s AgentOS runs this chat; open it to send from here`
        : `${name} isn't linked to its AgentOS; link it in Machines to chat with its sessions`
    );
  }
}

// Why reattaching found no worker to keep: nothing listens on its socket,
// or it was an idle one from an older build, retired.
const RETIRED = "RETIRED";
const GONE = ["ECONNREFUSED", "ENOENT", RETIRED];

// The session's worker, connected; started first if none is running,
// unless only an existing one will do (reattaching, stopping).
async function ensureLive(sessionId: string, spawn = true): Promise<Live> {
  const existing = registry.live.get(sessionId);
  if (existing && !existing.retiring) return existing;
  // A message for a worker that's on its way out goes to a current one.
  if (existing) retire(sessionId, existing, false);
  const pending = registry.connecting.get(sessionId);
  if (pending) return pending;
  const connecting = (async () => {
    // Demo chat runs in-process (lib/chat/demo); no worker ever starts.
    if (demoMode()) throw new Error(DEMO_REFUSAL);
    checkChattable(getSession(sessionId));
    let live: Live | null = null;
    const handlers = {
      onEvent: (e: WorkerEvent) => live && onWorkerEvent(sessionId, live, e),
      onClose: (detached: boolean) => {
        if (live && registry.live.get(sessionId) === live) {
          registry.live.delete(sessionId);
          emit(sessionId, { type: "compacting", compacting: null });
          emit(sessionId, { type: "state", state: "idle" });
        }
        // It retired itself for a current worker, or ended its agent's
        // conversation at the context threshold: what it queued goes now.
        if (live?.retireSent || refreshedAway(sessionId))
          resumed.delete(sessionId);
        // Its agent died mid-turn, with messages still queued, or with a
        // turn cut off. (One this server let go, it stopped on purpose.)
        if (live && !detached)
          void resumeInterrupted(sessionId)
            .then(() => resumeQueue(sessionId))
            .catch((error) =>
              console.error(`Not resuming ${sessionId}:`, error)
            );
      },
    };
    // No worker running: its agent ended, and with it every job it ran.
    const hadWorker = runningWorkers().includes(sessionId);
    let { client, hello } = await connectWorker(sessionId, spawn, handlers);
    if (!hadWorker) emitEnded(sessionId, undefined, endRunningTasks(sessionId));
    emitEnded(sessionId, undefined, endOrphanedTasks(sessionId));
    let activity = restoreActivity(sessionId, hello.state);
    // An idle worker left over from before a redeploy: retire it, and start
    // a fresh one only when a message needs it. One still running background
    // work keeps it, and goes when that ends.
    if (
      isStaleWorker(hello.build, buildId(), hello.state) &&
      !activity.tasks.size
    ) {
      client.command({ type: "close" });
      client.detach();
      await waitForExit(sessionId);
      removeStaleSocket(sessionId);
      if (!spawn)
        throw Object.assign(
          new Error(`retired a stale worker for ${sessionId}`),
          { code: RETIRED }
        );
      ({ client, hello } = await connectWorker(sessionId, true, handlers));
      emitEnded(sessionId, undefined, endRunningTasks(sessionId));
      activity = restoreActivity(sessionId, hello.state);
    }
    live = {
      worker: client,
      state: hello.state,
      compacting: hello.compacting ?? null,
      streaming: new Map(hello.streaming.map((i) => [i.id, i])),
      activity,
      build: hello.build,
      canPlan: !!hello.caps?.includes("plan"),
      canQueue: !!hello.caps?.includes("queue"),
      canFresh: !!hello.caps?.includes("fresh"),
      canBackground: !!hello.caps?.includes("background"),
      canMcpAuth: !!hello.caps?.includes("mcp_auth"),
    };
    // From an older build and busy, or running background work: it goes at
    // its next turn boundary, by itself if it can. Messages meanwhile wait
    // in the queue rather than keep it on old code (an orchestrator, fed
    // events mid-turn, might otherwise never be idle).
    if (hello.build !== buildId() && hello.caps?.includes("retire")) {
      client.command({ type: "retire" });
      live.retireSent = true;
    }
    registry.live.set(sessionId, live);
    // A setting changed while no worker was attached (a restart, a dropped
    // socket) reaches it now; both are safe to repeat.
    const saved = getSession(sessionId);
    client.command({ type: "set_access", access: saved.chat_access });
    if (live.canPlan)
      client.command({ type: "set_plan", plan: !!saved.chat_plan });
    emit(sessionId, { type: "state", state: live.state });
    if (live.compacting)
      emit(sessionId, { type: "compacting", compacting: live.compacting });
    return live;
  })();
  registry.connecting.set(sessionId, connecting);
  try {
    return await connecting;
  } finally {
    registry.connecting.delete(sessionId);
  }
}

// Its agent runs on another machine now (a worker here would fork it), or
// its move already took the queue.
function refuseAway(sessionId: string): void {
  const away = chatRefusal(sessionId);
  if (away) throw new Error(away);
}

// Held since the caller last looked (a move or Land began while a worker
// started): the message waits in the queue instead of starting a turn.
function queuedIfHeld(
  sessionId: string,
  m: { id: string; text: string; images?: ChatImage[] } & SentBy
): boolean {
  refuseAway(sessionId);
  if (!chatHold(sessionId)) return false;
  enqueue(sessionId, { ...m, ...sentBy(m) });
  emitQueue(sessionId);
  return true;
}

const sentBy = ({ from, peer, origin }: SentBy): SentBy => ({
  from,
  peer,
  origin,
});

// Already a message in the chat or its queue.
const taken = (sessionId: string, id: string) =>
  hasItem(sessionId, id) || listQueue(sessionId).some((q) => q.id === id);

export async function sendChat(
  sessionId: string,
  input: {
    text: string;
    images?: ChatImage[];
    // Typed in the composer: waits in the queue while a turn runs.
    queue?: boolean;
    // Compact a stale chat first (lib/chat/stale).
    compact?: CompactFirst;
    // The client's own id for it, so a resend after a reconnect is a no-op.
    id?: string;
  } & SentBy
): Promise<void> {
  const text = input.text.trim();
  if (!text && !input.images?.length) return;
  if (input.id && taken(sessionId, input.id)) return;
  refuseAway(sessionId);
  const id = input.id ?? `user-${Date.now()}-${randomUUID().slice(0, 5)}`;
  // Its worktree is still being set up, its task hasn't launched (held by
  // Pause, say), or it's moving or landing: the message waits its turn.
  if (settingUp(sessionId) || launchPending(sessionId) || chatHold(sessionId)) {
    enqueue(sessionId, {
      id,
      text,
      images: input.images,
      ...sentBy(input),
    });
    emitQueue(sessionId);
    return;
  }
  const live = await ensureLive(sessionId);
  // Sent again while the worker was starting.
  if (input.id && taken(sessionId, id)) return;
  if (queuedIfHeld(sessionId, { ...input, id, text })) return;
  live.worker.command({
    type: "send",
    id,
    text,
    images: input.images,
    ...sentBy(input),
    queue: input.queue,
    compact: input.compact,
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

const refreshedAway = (sessionId: string) =>
  !!(
    db
      .prepare(`SELECT chat_refreshed FROM sessions WHERE id = ?`)
      .get(sessionId) as { chat_refreshed: number } | undefined
  )?.chat_refreshed;

// A queue no worker is left to send (it was retired, or its agent died):
// a fresh worker sends it in order. Never interrupts: a worker that's busy
// sends its queue when its turn ends. At most once a minute per
// conversation, so a worker that can't start isn't restarted in a loop.
const RESUME_EVERY_MS = 60_000;
const RESUME_WITHIN_MS = 60 * 60 * 1000;
const resumed = new Map<string, number>();
async function resumeQueue(sessionId: string): Promise<void> {
  if (
    !listQueue(sessionId).length ||
    holdsQueue(sessionId) ||
    launchPending(sessionId) ||
    chatHold(sessionId) ||
    chatRefusal(sessionId)
  )
    return;
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

// A turn whose worker went away mid-step (a restart, its tmux server
// killed): the agent is told once, through its saved conversation, to check
// what it was doing and carry on, and a task's orchestrator hears about it
// rather than finding it idle. The note's id names the cut-off step, so
// neither a second restart nor a retry sends it twice, and a resumed turn
// that's cut off again is left for the orchestrator.
const resuming = new Set<string>();
export async function resumeInterrupted(sessionId: string): Promise<void> {
  // Called unawaited (a socket's close, startup): nothing may escape it.
  try {
    await resumeCutOff(sessionId);
  } catch (error) {
    console.error(
      `Not resuming ${sessionId}'s cut-off turn:`,
      error instanceof Error ? error.message : error
    );
  }
}

async function resumeCutOff(sessionId: string): Promise<void> {
  const row = db
    .prepare(
      `SELECT s.name, s.view, s.archived_at, s.task_status, s.role,
         COALESCE(s.workspace_id, p.workspace_id) AS workspace_id
       FROM session_rows s LEFT JOIN projects p ON p.id = s.project_id
       WHERE s.id = ?`
    )
    .get(sessionId) as
    | Pick<
        Session,
        | "name"
        | "view"
        | "archived_at"
        | "workspace_id"
        | "task_status"
        | "role"
      >
    | undefined;
  if (row?.view !== "chat" || row.archived_at) return;
  if (holdsQueue(sessionId) || launchPending(sessionId)) return;
  const cut = cutOffTurn(sessionId, Date.now() - RESUME_WITHIN_MS);
  if (!cut || hasItem(sessionId, cut.resumeId) || resuming.has(cut.resumeId))
    return;
  resuming.add(cut.resumeId);
  const task =
    row.workspace_id &&
    row.task_status === "running" &&
    row.role !== "orchestrator"
      ? row.workspace_id
      : null;
  try {
    if (cut.again) {
      if (task)
        queueEvent(
          task,
          `interrupted:${sessionId}:${cut.last}`,
          sessionId,
          `task ${row.name}: interrupted again after resuming; it's idle until told to carry on`
        );
      return;
    }
    await sendChatConfirmed(sessionId, {
      id: cut.resumeId,
      text: RESUME_NOTE,
      from: "agentos",
      origin: { kind: "event", label: "AgentOS" },
      // Down past its cache, a long chat is compacted before it carries on.
      compact: "auto",
    });
    if (task)
      queueEvent(
        task,
        `interrupted:${sessionId}:${cut.last}`,
        sessionId,
        `task ${row.name}: interrupted by a restart, resumed`
      );
  } finally {
    resuming.delete(cut.resumeId);
  }
}

// Sends a queued message now: a running turn stops for it, as on Esc.
// `during`: the user message whose turn the reader saw running, so a turn
// that started since (the next queued one) isn't the one stopped.
// Why a queued message can't go now: its worktree is setting up, or its
// task hasn't launched and it isn't the launch's own first message.
export function sendNowRefusal(sessionId: string, id: string): string | null {
  if (settingUp(sessionId)) return "It's sent once the worktree is set up";
  const held = chatRefusal(sessionId) ?? chatHold(sessionId);
  if (held) return held;
  if (launchPending(sessionId) && id !== firstMessageId(sessionId))
    return "It's sent once the task has started";
  return null;
}

export async function sendQueuedNow(
  sessionId: string,
  id: string,
  during?: string
) {
  if (!listQueue(sessionId).some((m) => m.id === id)) return;
  const refusal = sendNowRefusal(sessionId, id);
  if (refusal) throw new Error(refusal);
  const live = await ensureLive(sessionId);
  const held = sendNowRefusal(sessionId, id);
  if (held) throw new Error(held);
  if (!live.canQueue)
    throw new Error("Reload to send this: the chat is on an older version");
  live.worker.command({ type: "send_now", id, during });
}

// An orchestrator's "@" index starts building when its chat opens.
export function warmChatFileIndexes(sessionId: string): void {
  const roots = mentionRoots(sessionId);
  if (roots) warmFileIndexes(roots);
}

// Files and folders for an @mention: an orchestrator's come from its HQ and
// project repositories (the agent only sees its scratch folder); any other
// session's from the agent's own matching when its worker is up and has an
// answer, ripgrep over the folder otherwise.
export async function chatFileSuggestions(
  sessionId: string,
  query: string
): Promise<FileSuggestion[]> {
  const roots = mentionRoots(sessionId);
  if (roots) return multiRootFileSuggestions(roots, query, sessionId);
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
  input: { text: string; id?: string; compact?: CompactFirst } & SentBy,
  timeoutMs = 10_000
): Promise<"delivered" | "queued"> {
  const text = input.text.trim();
  if (!text) throw new Error("Message is empty");
  refuseAway(sessionId);
  // A task not launched yet takes it after its first message; a held one
  // once it's let go.
  if (launchPending(sessionId) || chatHold(sessionId)) {
    enqueue(sessionId, {
      id: input.id ?? `user-${Date.now()}-${randomUUID().slice(0, 5)}`,
      text,
      ...sentBy(input),
    });
    emitQueue(sessionId);
    return "queued";
  }
  const live = await ensureLive(sessionId);
  const wasBusy = live.state === "running" || live.state === "waiting";
  const id = input.id ?? `user-${Date.now()}-${randomUUID().slice(0, 5)}`;
  // Already taken (a retry of the same message): nothing to wait for.
  if (input.id && hasItem(sessionId, id)) return "delivered";
  if (queuedIfHeld(sessionId, { ...input, id, text })) return "queued";
  let set = registry.listeners.get(sessionId);
  if (!set) registry.listeners.set(sessionId, (set = new Set()));
  const listeners = set;
  let listener: Listener = () => {};
  let timer: NodeJS.Timeout | undefined;
  // The worker queued it rather than start a turn (a hold took effect).
  let queuedByWorker = false;
  const inQueue = (queue: { id: string }[]) =>
    (queuedByWorker = queue.some((q) => q.id === id));
  const accepted = new Promise<void>((resolve, reject) => {
    listener = (m) => {
      if (m.type === "item" && m.item.id === id) resolve();
      else if (m.type === "queue" && inQueue(m.queue)) resolve();
    };
    timer = setTimeout(() => {
      // The event can be missed across a reconnect; the row can't.
      if (hasItem(sessionId, id) || inQueue(listQueue(sessionId))) resolve();
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
      ...sentBy(input),
      compact: input.compact,
    });
    await accepted;
  } finally {
    clearTimeout(timer);
    listeners.delete(listener);
  }
  return queuedByWorker || wasBusy ? "queued" : "delivered";
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
  const target = getItem(sessionId, from);
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

// A plain Esc: ends the turn the way the agent would, and leaves a queue
// behind it alone. Stop (./stop stopChatTurn) is the one that must end it.
export async function interruptChat(sessionId: string): Promise<void> {
  registry.live.get(sessionId)?.worker.command({ type: "interrupt" });
}

// Ends the conversation: its worker closes the agent and exits.
// How long a worker from an older build waits for its guess at the next
// message before it goes.
const SUGGESTION_WAIT_MS = 2 * 60 * 1000;

function retire(sessionId: string, live: Live, resume = true): void {
  clearTimeout(live.retiring);
  live.retiring = undefined;
  if (registry.live.get(sessionId) !== live) return;
  stopChat(sessionId);
  if (resume) void resumeQueue(sessionId);
}

// A fresh start the reader asked for, by the path the context threshold
// takes (the worker's endConversation): "now" when nothing is running, else
// "after-turn", at the next turn boundary. The next worker reads the brief
// and permissions as the server has them then, nothing held over.
export class FreshRefusal extends Error {}

export async function freshStartChat(
  sessionId: string
): Promise<"now" | "after-turn"> {
  const session = getSession(sessionId);
  // A terminal agent's conversation isn't ours to release: it keeps running.
  if (session.view !== "chat" || session.archived_at)
    throw new FreshRefusal("Only an open chat session can start fresh");
  try {
    checkChattable(session);
  } catch (e) {
    throw new FreshRefusal(e instanceof Error ? e.message : String(e));
  }
  const live =
    registry.live.get(sessionId) ??
    (runningWorkers().includes(sessionId)
      ? await ensureLive(sessionId, false).catch(() => undefined)
      : undefined);
  if (live) {
    // A worker from before this existed would ignore the command.
    if (live.canFresh) {
      live.worker.command({ type: "fresh" });
      return live.state === "idle" && !live.activity.tasks.size
        ? "now"
        : "after-turn";
    }
    if (live.state !== "idle")
      throw new FreshRefusal("Try again when the current turn has ended");
    stopChat(sessionId);
  }
  releaseConversation(sessionId, REQUESTED_FRESH);
  const item: ChatItem = {
    id: `note-refresh-${Date.now()}`,
    kind: "note",
    tone: "note",
    text: `Fresh start: the agent starts a new conversation with its brief${session.role === "orchestrator" ? " and the current state from AgentOS" : ""} at its next message.`,
    createdAt: Date.now(),
  };
  saveItem(sessionId, item);
  emit(sessionId, { type: "item", item });
  return "now";
}

export function stopChat(sessionId: string): void {
  const live = registry.live.get(sessionId);
  if (live) {
    registry.live.delete(sessionId);
    if (live.compacting)
      emit(sessionId, { type: "compacting", compacting: null });
    live.worker.command({ type: "close" });
    live.worker.detach();
    return;
  }
  if (runningWorkers().includes(sessionId))
    void ensureLive(sessionId, false)
      .then(() => stopChat(sessionId))
      .catch(() => {});
}

// Lets go of a chat that was held (./hold): what was queued meanwhile is
// sent now, by a fresh worker.
export async function releaseChat(sessionId: string): Promise<void> {
  resumed.delete(sessionId);
  await resumeQueue(sessionId);
}

export const chatCompacting = (sessionId: string): Compacting | null =>
  registry.live.get(sessionId)?.compacting ?? null;

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

// Moves a blocking call to the background and says how that went.
export async function backgroundChatTask(
  sessionId: string,
  toolUseId: string | undefined,
  reply: (m: ChatServerMessage) => void
): Promise<void> {
  const live = registry.live.get(sessionId);
  const r = live?.canBackground
    ? await live.worker.background(toolUseId)
    : { error: "unavailable" };
  reply({
    type: "background_result",
    toolUseId,
    ok: !!r.ok,
    ...(r.error && { error: r.error }),
  });
}

// The session's running worker, when it can sign in to MCP servers; why not
// otherwise (a chat on another machine, an idle one, one from an older build).
export function mcpAuthWorker(sessionId: string): WorkerClient {
  checkChattable(getSession(sessionId));
  const live = registry.live.get(sessionId);
  if (!live || live.retiring)
    throw new Error(
      "This chat's agent isn't running. Send /mcp again to wake it, then sign in."
    );
  if (!live.canMcpAuth)
    throw new Error(
      "This chat's agent is from an older AgentOS build. Send it a message or reopen the chat, then try again."
    );
  return live.worker;
}

export function chatTaskOutput(
  sessionId: string,
  taskId: string
): TaskOutput | null {
  const task = itemsOfKind(sessionId, "task").find((i) => i.taskId === taskId);
  if (task?.kind !== "task") return null;
  return taskOutputTail(taskId, task.outputFile);
}

// What a watcher is sent of stored items: the live text of what's still
// streaming, or with no conversation running, nothing left running.
function present(sessionId: string, items: ChatItem[]): ChatItem[] {
  const live = registry.live.get(sessionId);
  if (live) return items.map((i) => live.streaming.get(i.id) ?? i);
  return runningWorkers().includes(sessionId) ? items : settle(items);
}

// Snapshot then live updates. Returns the unsubscribe function. Every
// client gets the latest page and asks for older ones.
export function watchChat(sessionId: string, listener: Listener): () => void {
  const live = registry.live.get(sessionId);
  const page = readPage(sessionId);
  const onPage = new Set(page.items.map((i) => i.id));
  // The composer lists background work still going or just done, even when
  // it started before the page.
  const recent = Date.now() - 60 * 60 * 1000;
  const tasks = recentTasks(sessionId, recent).filter((t) => !onPage.has(t.id));
  listener({
    type: "snapshot",
    items: present(sessionId, page.items),
    cursor: page.cursor,
    hasMore: page.hasMore,
    tasks: present(sessionId, tasks),
    state: live?.state ?? "idle",
    compacting: live?.compacting ?? null,
    queue: listQueue(sessionId),
    suggestion: getSession(sessionId).chat_suggestion ?? null,
  });
  listener({ type: "context", context: savedContext(sessionId) });
  sendCapabilities(sessionId, listener).catch((error) =>
    console.error(`[chat ${sessionId}] capabilities not sent:`, error)
  );
  let set = registry.listeners.get(sessionId);
  if (!set) registry.listeners.set(sessionId, (set = new Set()));
  set.add(listener);
  return () => {
    set?.delete(listener);
    releaseUnwatchedSoon();
  };
}

// The page before `before`, as the reader scrolls up.
export function chatHistory(sessionId: string, before: number): ItemPage {
  const page = readPage(sessionId, before);
  return { ...page, items: present(sessionId, page.items) };
}

export const chatToolBody = toolBody;

// After a restart: reconnect to every worker still running a conversation,
// and send the queues of conversations whose worker is gone.
export async function reattachChats(): Promise<void> {
  // A worker nothing listens for (killed hard, its socket left behind)
  // isn't running anything: its turn and queue are picked up below. One
  // slow to say hello is busy, not gone, and is left alone.
  const live = new Set<string>();
  await Promise.all(
    runningWorkers().map((id) =>
      ensureLive(id, false)
        .then(() => live.add(id))
        .catch((error) => {
          const code = (error as NodeJS.ErrnoException).code;
          if (!GONE.includes(code ?? "")) live.add(id);
          console.error(`Not reattaching chat ${id}:`, error.message ?? error);
        })
    )
  );
  // A task saved as running with no worker behind it has no job either.
  for (const id of sessionsWithRunningTasks())
    if (!live.has(id)) endRunningTasks(id);
  // Turns cut off while no worker was left to finish them, then queues.
  // One at a time, and only what was queued recently: a backlog from long
  // ago isn't sent unasked by a restart (it stays on screen to send).
  for (const id of cutOffSessions(Date.now() - RESUME_WITHIN_MS))
    if (!live.has(id)) await resumeInterrupted(id);
  for (const id of queuedSessions(Date.now() - RESUME_WITHIN_MS))
    if (!live.has(id)) await resumeQueue(id);
  await recheckPlanning((id, m) => sendQueuedNow(id, m), planEnv);
}

// Asks a chat's worker to end at its next turn boundary, so the next message
// starts one that reads its settings afresh (an orchestrator's permissions,
// say). A worker already gone, or too old to understand, needs nothing.
export async function retireChat(sessionId: string): Promise<void> {
  const live =
    registry.live.get(sessionId) ??
    (runningWorkers().includes(sessionId)
      ? await ensureLive(sessionId, false).catch(() => undefined)
      : undefined);
  if (!live || live.retireSent) return;
  live.worker.command({ type: "retire" });
  live.retireSent = true;
}
