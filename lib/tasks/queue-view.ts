/** What clients see of the line: each task's place, rank and why it waits. */

import { db } from "../db";
import { DEFAULT_PRIORITY, isPriority } from "./schedule-types";
import { scoreParts } from "./schedule";
import { afterLabel, label, sqliteMs } from "./queue-rows";
import type { QueueRow, QueuedTaskView } from "./queue-types";

// Every task still in line (and any that failed to start), in line order.
export function listQueue(): QueuedTaskView[] {
  const rows = db
    .prepare(
      `SELECT q.*, p.name AS project_name, p.workspace_id AS workspace_id,
         (SELECT COUNT(*) FROM bus_messages b WHERE b.to_id = q.id
            AND b.held_queued = 1 AND b.delivered_at IS NULL AND b.read_at IS NULL) AS held_count
       FROM task_queue q LEFT JOIN projects p ON p.id = q.project_id
       WHERE q.status IN ('queued', 'starting', 'failed')
       ORDER BY q.position`
    )
    .all() as (QueueRow & {
    project_name: string | null;
    workspace_id: string | null;
    held_count: number;
  })[];
  const places = new Map<string, number>();
  // The score order within each line, by priority and age alone: holds
  // don't move a task's rank.
  const now = Date.now();
  const ranked = new Map<string, { rank: number; of: number }>();
  const lines = new Map<string, typeof rows>();
  for (const r of rows.filter((r) => r.status === "queued")) {
    const key = r.workspace_id ?? `project:${r.project_id}`;
    lines.set(key, [...(lines.get(key) ?? []), r]);
  }
  for (const line of lines.values()) {
    const order = line
      .map((r) => ({ r, score: scoreOf(r, now) }))
      .sort((a, b) => b.score - a.score || a.r.position - b.r.position);
    order.forEach(({ r }, i) =>
      ranked.set(r.id, { rank: i + 1, of: order.length })
    );
  }
  return rows.map((r) => {
    const key = r.workspace_id ?? `project:${r.project_id}`;
    const place = (places.get(key) ?? 0) + 1;
    places.set(key, place);
    const rank = ranked.get(r.id);
    return {
      id: r.id,
      name: label(r),
      prompt: r.prompt,
      projectId: r.project_id,
      projectName: r.project_name,
      workspaceId: r.workspace_id,
      status: r.status,
      position: place,
      after: afterLabel(r),
      afterId: r.after_task,
      note: r.note,
      error: r.error,
      startedBy: r.started_by,
      createdAt: r.created_at,
      priority: isPriority(r.priority) ? r.priority : DEFAULT_PRIORITY,
      wait: r.wait_code,
      rank: rank?.rank ?? place,
      of: rank?.of ?? place,
      held: r.held_count,
    };
  });
}

function scoreOf(r: QueueRow, now: number): number {
  return scoreParts(
    {
      kind: "start",
      priority: isPriority(r.priority) ? r.priority : DEFAULT_PRIORITY,
      waitingSinceMs: sqliteMs(r.created_at),
    },
    now
  ).score;
}

export const queuedView = (id: string) =>
  listQueue().find((q) => q.id === id) ?? null;

// A task still waiting in the line (or failed to start) by id, an id prefix
// of 4+ characters or, when asked, its name; in one workspace.
export function findQueued(
  workspaceId: string,
  ref: string,
  opts: { byName?: boolean } = {}
): QueueRow | null {
  const want = ref.trim();
  const rows = db
    .prepare(
      `SELECT q.* FROM task_queue q JOIN projects p ON p.id = q.project_id
       WHERE p.workspace_id = ? AND q.status IN ('queued', 'failed')`
    )
    .all(workspaceId) as QueueRow[];
  const lower = want.toLowerCase();
  const hits = rows.filter(
    (r) =>
      r.id === want ||
      (want.length >= 4 && r.id.startsWith(want)) ||
      (opts.byName && label(r).toLowerCase() === lower)
  );
  if (hits.length > 1)
    throw new Error(
      `"${ref}" matches ${hits.length} queued tasks: ${hits.map((h) => `${label(h)} (${h.id.slice(0, 8)})`).join(", ")}`
    );
  return hits[0] ?? null;
}
