import type { QueuedTaskView } from "@/lib/tasks/queue";

export interface QueuedRow {
  item: QueuedTaskView;
  // The task it waits on, when that task is a session here to open.
  afterSessionId: string | null;
  // Whether it has a queued neighbour in its line to swap with.
  canMoveUp: boolean;
  canMoveDown: boolean;
}

// The current workspace's queued tasks (all of them with no workspace
// picked), under the project filter and search, in line order. One that
// has already become a session is left to its session row, so a start
// never shows the task twice.
export function queuedRows(input: {
  queue: QueuedTaskView[];
  sessionIds: ReadonlySet<string>;
  workspaceId: string | null;
  projectId?: string | null;
  query?: string;
}): QueuedRow[] {
  const q = (input.query ?? "").trim().toLowerCase();
  // Each line's waiting tasks, in order, for what a move can swap with.
  const lines = new Map<string, string[]>();
  for (const item of input.queue) {
    if (item.status !== "queued") continue;
    const key = lineOf(item);
    lines.set(key, [...(lines.get(key) ?? []), item.id]);
  }
  return input.queue
    .filter(
      (item) =>
        !input.sessionIds.has(item.id) &&
        (!input.workspaceId || item.workspaceId === input.workspaceId) &&
        (!input.projectId || item.projectId === input.projectId) &&
        (!q ||
          item.name.toLowerCase().includes(q) ||
          (item.projectName ?? "").toLowerCase().includes(q))
    )
    .map((item) => {
      const line = lines.get(lineOf(item)) ?? [];
      const at = line.indexOf(item.id);
      return {
        item,
        afterSessionId:
          item.afterId && input.sessionIds.has(item.afterId)
            ? item.afterId
            : null,
        canMoveUp: at > 0,
        canMoveDown: at >= 0 && at < line.length - 1,
      };
    });
}

// A workspace's line, or a project's when it has no workspace.
const lineOf = (item: QueuedTaskView) =>
  item.workspaceId ?? `project:${item.projectId}`;

// Under the title: its place in line or what it waits on, then the project.
export function queuedSubtitle(item: QueuedTaskView): {
  lead: string;
  after: string | null;
} {
  if (item.status === "starting") return { lead: "Starting", after: null };
  if (item.status === "failed")
    return { lead: item.error ?? "Failed to start", after: null };
  // Why a start it tried is held: the orchestrator paused, a brake.
  if (item.note) return { lead: item.note, after: null };
  if (item.after) return { lead: "After", after: item.after };
  return { lead: `#${item.position} in line`, after: null };
}

export type QueueMenuAction = "start" | "up" | "down" | "remove";

// The row's menu: a waiting task can start now, move or go; a failed one
// can only go; one starting has none.
export function queueMenu(
  row: QueuedRow
): { action: QueueMenuAction; label: string; disabled: boolean }[] {
  const { status } = row.item;
  if (status === "failed")
    return [{ action: "remove", label: "Remove", disabled: false }];
  if (status !== "queued") return [];
  return [
    { action: "start", label: "Start now", disabled: false },
    { action: "up", label: "Move up", disabled: !row.canMoveUp },
    { action: "down", label: "Move down", disabled: !row.canMoveDown },
    { action: "remove", label: "Remove", disabled: false },
  ];
}

// What each menu action asks of /api/tasks/queue/[id].
export function queueRequest(
  id: string,
  action: QueueMenuAction
): { url: string; init: RequestInit } {
  const url = `/api/tasks/queue/${encodeURIComponent(id)}`;
  if (action === "remove") return { url, init: { method: "DELETE" } };
  return {
    url,
    init: {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    },
  };
}
