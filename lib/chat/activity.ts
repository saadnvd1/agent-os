import type { ChatState } from "./events";
import { registry, type Live } from "./registry";
import { listItems } from "./store";
import type { WorkerEvent } from "./worker/protocol";

// Keeps a conversation's "what it's doing now" current from its events.
export function track(live: Live, e: WorkerEvent): void {
  const a = live.activity;
  if (e.type === "state") {
    if (e.state === "running" && !a.turnStartedAt) a.turnStartedAt = Date.now();
    if (e.state === "idle") {
      a.turnStartedAt = undefined;
      a.tools.clear();
    }
  } else if (e.type === "item" && e.item.kind === "tool") {
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
  for (const i of items) {
    if (i.kind === "tool" && i.status === "running" && state !== "idle")
      activity.tools.set(i.id, { label: i.title, since: i.createdAt });
    if (i.kind === "task" && i.status === "running" && !i.ambient)
      activity.tasks.add(i.taskId);
  }
  return activity;
}

// One line on what a chat session is doing, for the session list and
// notifications: the step running now and since when.
export function chatActivity(
  sessionId: string
): { label: string; since?: number; background: number } | null {
  const live = registry.live.get(sessionId);
  if (!live) return null;
  const a = live.activity;
  const background = a.tasks.size;
  if (live.state === "waiting")
    return { label: "Needs your answer", background };
  if (live.state !== "running")
    return background ? { label: "Idle", background } : null;
  const tool = [...a.tools.values()].at(-1);
  return tool
    ? { label: tool.label, since: tool.since, background }
    : { label: "Thinking", since: a.turnStartedAt, background };
}
