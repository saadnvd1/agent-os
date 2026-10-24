import type { ChatContext, ChatItem } from "./events";
import { getSession, registry, type Listener } from "./registry";
import { releaseUnwatchedSoon, sendCapabilities } from "./settings";
import { recentTasks, settle } from "./store";
import { readPage, toolBody, type ItemPage } from "./page";
import { listQueue } from "./queued";
import { runningWorkers } from "./worker/client";
import { demoLive } from "./demo";

function savedContext(sessionId: string): ChatContext | null {
  const raw = getSession(sessionId).chat_context;
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ChatContext;
  } catch {
    return null;
  }
}

// What a watcher is sent of stored items: the live text of what's still
// streaming, or with no conversation running, nothing left running.
function present(sessionId: string, items: ChatItem[]): ChatItem[] {
  const live = registry.live.get(sessionId);
  if (live) return items.map((i) => live.streaming.get(i.id) ?? i);
  if (demoLive(sessionId)) return items;
  return runningWorkers().includes(sessionId) ? items : settle(items);
}

// Snapshot then live updates. Returns the unsubscribe function. Every
// client gets the latest page and asks for older ones.
export function watchChat(sessionId: string, listener: Listener): () => void {
  const live = registry.live.get(sessionId);
  const demo = demoLive(sessionId);
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
    state: live?.state ?? demo?.state ?? "idle",
    compacting: live?.compacting ?? demo?.compacting ?? null,
    modelWait: live?.modelWait ?? demo?.wait ?? null,
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
