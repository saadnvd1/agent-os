import type { ChatItem, ChatState } from "./events";
import { formatElapsed } from "./elapsed";
import { registry, type Live } from "./registry";
import { stallThresholdMs } from "./stall";
import { listItems } from "./store";
import type { WorkerEvent } from "./worker/protocol";

const lastWhat = (i: ChatItem): string =>
  i.kind === "tool"
    ? i.status === "running"
      ? i.title
      : `finished ${i.title}`
    : i.kind === "assistant"
      ? "writing a reply"
      : i.kind === "reasoning"
        ? "thinking"
        : i.kind === "user"
          ? "your message"
          : i.kind;

// Keeps a conversation's "what it's doing now" current from its events.
export function track(live: Live, e: WorkerEvent): void {
  const a = live.activity;
  if (e.type === "state") {
    if (e.state === "running" && !a.turnStartedAt) {
      a.turnStartedAt = Date.now();
      a.lastAt = a.turnStartedAt;
      a.lastWhat = "starting the turn";
    }
    if (e.state === "idle") {
      a.turnStartedAt = undefined;
      a.lastAt = a.lastWhat = undefined;
      a.tools.clear();
    }
  } else if (e.type === "item" && e.item.kind === "turn_end") {
    // A queued message starts the next turn with no idle in between.
    a.turnStartedAt = undefined;
    a.lastAt = a.lastWhat = undefined;
    a.tools.clear();
  } else if (e.type === "item" || e.type === "delta") {
    a.lastAt = Date.now();
    a.lastWhat = e.type === "delta" ? "writing" : lastWhat(e.item);
  }
  if (e.type === "item" && e.item.kind === "user") a.sends = (a.sends ?? 0) + 1;
  if (e.type === "item" && e.item.kind === "tool") {
    if (e.item.status === "running")
      a.tools.set(e.item.id, { label: e.item.title, since: e.item.createdAt });
    else a.tools.delete(e.item.id);
  } else if (e.type === "item" && e.item.kind === "task" && !e.item.ambient) {
    if (e.item.status === "running") a.tasks.add(e.item.taskId);
    else a.tasks.delete(e.item.taskId);
  }
}

// After a reattach, what's still running comes from the saved items.
export function restoreActivity(sessionId: string, state: ChatState) {
  const items = listItems(sessionId);
  const activity: Live["activity"] = { tools: new Map(), tasks: new Set() };
  if (state !== "idle")
    activity.turnStartedAt = items.findLast(
      (i) => i.kind === "user"
    )?.createdAt;
  if (state !== "idle") {
    const last = items.at(-1);
    activity.lastAt = last?.createdAt ?? activity.turnStartedAt;
    activity.lastWhat = last ? lastWhat(last) : undefined;
  }
  for (const i of items) {
    if (i.kind === "tool" && i.status === "running" && state !== "idle")
      activity.tools.set(i.id, { label: i.title, since: i.createdAt });
    if (i.kind === "task" && i.status === "running" && !i.ambient)
      activity.tasks.add(i.taskId);
  }
  return activity;
}

export interface Stall {
  silentMs: number;
  // What it last did.
  last: string;
  // When that was: one stall per value, so a condition keyed on it fires
  // once and a new one starts only after activity resumes.
  since: number;
}

// A turn that has produced nothing (no token, item or result) for the
// threshold. Never one waiting on an answer, nor one with a background task
// running: a command it started can legitimately be quiet.
const TOOL_STALL_FACTOR = 4;

export function stallOf(
  live: Live,
  now: number,
  thresholdMs: number
): Stall | null {
  const a = live.activity;
  if (live.state !== "running" || thresholdMs <= 0 || a.tasks.size > 0)
    return null;
  // A foreground tool call (a long test run) says nothing while it works:
  // it gets a much longer allowance before it counts as stuck.
  if (a.tools.size > 0) thresholdMs *= TOOL_STALL_FACTOR;
  const since = a.lastAt ?? a.turnStartedAt;
  if (!since || now - since < thresholdMs) return null;
  return { silentMs: now - since, last: a.lastWhat ?? "unknown", since };
}

// Whether a chat on this machine is stalled now, by the app-wide threshold.
export function chatStall(sessionId: string): Stall | null {
  const live = registry.live.get(sessionId);
  return live ? stallOf(live, Date.now(), stallThresholdMs()) : null;
}

// One line on what a chat session is doing, for the session list and
// notifications: the step running now and since when.
export function chatActivity(sessionId: string): {
  label: string;
  since?: number;
  background: number;
  stalled?: Stall;
} | null {
  const live = registry.live.get(sessionId);
  if (!live) return null;
  const a = live.activity;
  const background = a.tasks.size;
  if (live.state === "waiting")
    return { label: "Needs your answer", background };
  if (live.state !== "running")
    return background ? { label: "Idle", background } : null;
  const stalled = stallOf(live, Date.now(), stallThresholdMs()) ?? undefined;
  if (stalled)
    return { label: "Stalled", since: stalled.since, background, stalled };
  const tool = [...a.tools.values()].at(-1);
  return tool
    ? { label: tool.label, since: tool.since, background }
    : { label: "Thinking", since: a.turnStartedAt, background };
}

// The same as one line: "Run the tests · 2m 14s · 1 running in background".
export function chatActivityLine(sessionId: string): string | null {
  const a = chatActivity(sessionId);
  if (!a) return null;
  const background = a.background
    ? `${a.background} running in background`
    : "";
  if (a.label === "Idle") return background || null;
  if (a.stalled)
    return `Stalled · no output for ${formatElapsed(a.stalled.silentMs)} · last: ${a.stalled.last}`;
  const parts = [a.label];
  if (a.since) parts.push(formatElapsed(Date.now() - a.since));
  if (background) parts.push(background);
  return parts.join(" · ");
}
