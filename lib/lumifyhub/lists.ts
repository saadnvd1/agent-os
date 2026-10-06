import type { LumifyHubClient } from "./client";
import type { TaskState } from "../tasks/state";
import type { LhList, LhListCategory } from "./types";

// The four lists a task's card moves through, in board order.
export const TASK_LISTS = [
  { key: "todo", name: "To Do", category: "unstarted" },
  { key: "in_progress", name: "In Progress", category: "started" },
  { key: "in_review", name: "In Review", category: "started" },
  { key: "done", name: "Done", category: "completed" },
] as const satisfies ReadonlyArray<{
  key: string;
  name: string;
  category: LhListCategory;
}>;

export type TaskListKey = (typeof TASK_LISTS)[number]["key"];

// Where a task's card belongs, or a terminal outcome that leaves it in place
// with a comment ("failed or dropped stays where it is").
export type CardTarget = TaskListKey | "failed" | "dropped";

export function cardTargetFor(state: TaskState | "queued"): CardTarget {
  switch (state) {
    case "queued":
      return "todo";
    case "working":
    case "needs-input":
    case "blocked":
      return "in_progress";
    case "review":
    case "checks-failing":
      return "in_review";
    case "merged":
      return "done";
    case "dropped":
      return "dropped";
    case "exited":
      return "failed";
  }
}

const normalize = (name: string) =>
  name.trim().toLowerCase().replace(/\s+/g, " ");

export function findList(lists: LhList[], name: string): LhList | undefined {
  const wanted = normalize(name);
  return lists.find((l) => normalize(l.name) === wanted);
}

// Positions for the board's lists once the missing task lists are slotted in
// after the task list that precedes them. Existing lists keep their order.
export function orderWithTaskLists(
  lists: LhList[],
  created: Set<string>
): string[] {
  const existing = [...lists]
    .filter((l) => !created.has(l.id))
    .sort((a, b) => a.position - b.position)
    .map((l) => l.id);
  for (const [i, spec] of TASK_LISTS.entries()) {
    const list = findList(lists, spec.name);
    if (!list || !created.has(list.id)) continue;
    const prev = TASK_LISTS.slice(0, i)
      .reverse()
      .map((s) => findList(lists, s.name))
      .find((l) => l && existing.includes(l.id));
    const at = prev ? existing.indexOf(prev.id) + 1 : 0;
    existing.splice(at, 0, list.id);
  }
  return existing;
}

const cache = new Map<
  string,
  { at: number; ids: Record<TaskListKey, string> }
>();

const loading = new Map<string, Promise<Record<TaskListKey, string>>>();

// Make sure the board has To Do / In Progress / In Review / Done, creating any
// that are missing and reusing what's there (matched case-insensitively).
// Concurrent callers for one board share a single load, so a list is never
// created twice.
export function ensureTaskLists(
  client: LumifyHubClient,
  boardId: string,
  fresh = false
): Promise<Record<TaskListKey, string>> {
  const hit = cache.get(boardId);
  if (!fresh && hit && Date.now() - hit.at < 60000) {
    return Promise.resolve(hit.ids);
  }
  let pending = loading.get(boardId);
  if (!pending) {
    pending = loadTaskLists(client, boardId).finally(() =>
      loading.delete(boardId)
    );
    loading.set(boardId, pending);
  }
  return pending;
}

async function loadTaskLists(
  client: LumifyHubClient,
  boardId: string
): Promise<Record<TaskListKey, string>> {
  const lists = await client.listLists(boardId);
  const created = new Set<string>();
  const hasCompleted = lists.some((l) => l.category === "completed");
  for (const spec of TASK_LISTS) {
    if (findList(lists, spec.name)) continue;
    // LumifyHub allows one completed list per board.
    const category =
      spec.category === "completed" && hasCompleted ? "started" : spec.category;
    const list = await client.createList(boardId, {
      name: spec.name,
      category,
    });
    lists.push(list);
    created.add(list.id);
  }
  if (created.size) {
    const order = orderWithTaskLists(lists, created);
    for (const [position, id] of order.entries()) {
      const list = lists.find((l) => l.id === id)!;
      if (list.position !== position) {
        await client.updateList(boardId, id, { position });
      }
    }
  }

  const ids = Object.fromEntries(
    TASK_LISTS.map((s) => [s.key, findList(lists, s.name)!.id])
  ) as Record<TaskListKey, string>;
  cache.set(boardId, { at: Date.now(), ids });
  return ids;
}

export function forgetLists(boardId: string): void {
  cache.delete(boardId);
}
