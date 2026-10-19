/**
 * The line's rows and slot counts: the small reads and writes everything else
 * in the queue builds on.
 */

import { db, type Session } from "../db";
import { getProject } from "../projects";
import { getWorkspace } from "../workspaces";
import { queuedLabel } from "./queue-held";
import type { Group } from "./schedule";
import type { QueueRow } from "./queue-types";

export const IN_FLIGHT = ["running", "moving"];

export const row = (id: string) =>
  db.prepare(`SELECT * FROM task_queue WHERE id = ?`).get(id) as
    QueueRow | undefined;

export const sessionOf = (id: string) =>
  db.prepare(`SELECT * FROM session_rows WHERE id = ?`).get(id) as
    Session | undefined;

export function patch(id: string, fields: Partial<QueueRow>): void {
  const keys = Object.keys(fields);
  if (!keys.length) return;
  db.prepare(
    `UPDATE task_queue SET ${keys.map((k) => `${k} = @${k}`).join(", ")} WHERE id = @id`
  ).run({ ...fields, id });
}

export const workspaceOf = (projectId: string) =>
  getProject(projectId)?.workspace_id ?? null;

// Direct starts under way, by workspace: their task rows don't exist until
// createTask gets that far, so they hold their slot here meanwhile.
// On globalThis: the custom server's watcher and the route bundles each load
// their own copy of this module, and must see one set of reservations.
const g = globalThis as unknown as {
  __agentosQueueReserved?: Map<string, number>;
};
export const reserved = (g.__agentosQueueReserved ??= new Map<
  string,
  number
>());

// Running tasks hold their slot until they finish (merged, dropped, done),
// PR open or not; a queued task being started counts too. A paused task
// gives its slot back until it resumes. A quick change
// runs no agent, so it holds none. Without a
// workspace, the project is the scope.
export function runningIn(
  scope: { workspaceId: string | null; projectId: string },
  forSlots = false
) {
  const where = scope.workspaceId
    ? `p.workspace_id = @ws`
    : `p.id = @project AND p.workspace_id IS NULL`;
  return (
    db
      .prepare(
        `SELECT s.id FROM session_rows s JOIN projects p ON p.id = s.project_id
         WHERE ${where} AND s.archived_at IS NULL AND s.quick_of IS NULL
           AND (s.pause_state IS NULL OR s.pause_state != 'paused')
           ${forSlots ? `AND NOT (COALESCE(s.plan_only, 0) = 1 AND COALESCE(s.plan_phase, '') != 'implementing')` : ""}
           AND s.task_status IN (${IN_FLIGHT.map((s) => `'${s}'`).join(", ")})`
      )
      .all({ ws: scope.workspaceId, project: scope.projectId }) as {
      id: string;
    }[]
  ).map((r) => r.id);
}

export function startingIn(workspaceId: string): number {
  return (
    (reserved.get(workspaceId) ?? 0) +
    (
      db
        .prepare(
          `SELECT COUNT(*) AS n FROM task_queue q JOIN projects p ON p.id = q.project_id
         WHERE q.status = 'starting' AND p.workspace_id = ?
           AND q.plan_only IS NULL`
        )
        .get(workspaceId) as { n: number }
    ).n
  );
}

export const limitOf = (workspaceId: string | null) =>
  workspaceId ? (getWorkspace(workspaceId)?.max_running_tasks ?? null) : null;

// Finished, as far as a wait on it goes: merged, dropped, done or handed to
// another machine, or a queued task that was removed or failed to start.
export function hasFinished(taskId: string): boolean {
  const s = sessionOf(taskId);
  if (s) return !!s.archived_at || !IN_FLIGHT.includes(s.task_status ?? "");
  const q = row(taskId);
  return !q || (q.status !== "queued" && q.status !== "starting");
}

// Still something to wait for under "any": in flight, and not a task whose
// PR was closed or merged and which nobody finished (that one never will).
export function stillWorking(taskId: string): boolean {
  if (hasFinished(taskId)) return false;
  const s = sessionOf(taskId);
  return !s || (s.pr_status !== "closed" && s.pr_status !== "merged");
}

export function afterMet(r: QueueRow): boolean {
  if (r.after_task && !hasFinished(r.after_task)) return false;
  if (r.after_any && !r.after_any_used) {
    const ids = JSON.parse(r.after_any) as string[];
    if (ids.length && !ids.some((id) => !stillWorking(id))) return false;
  }
  return true;
}

// A task named by id, id prefix or name, running or queued; in one
// workspace when given (the orchestrator's).
export function resolveAfter(
  ref: string,
  workspaceId: string | null
): { id: string; name: string } {
  const want = ref.trim();
  const lower = want.toLowerCase();
  const scope = workspaceId ? `AND p.workspace_id = @ws` : "";
  const candidates = db
    .prepare(
      `SELECT s.id, s.name FROM session_rows s JOIN projects p ON p.id = s.project_id
       WHERE s.archived_at IS NULL AND s.task_status IN ('running', 'moving') ${scope}
       UNION ALL
       SELECT q.id, COALESCE(q.name, q.prompt) AS name FROM task_queue q
         JOIN projects p ON p.id = q.project_id
       WHERE q.status IN ('queued', 'starting') ${scope}`
    )
    .all({ ws: workspaceId }) as { id: string; name: string }[];
  const exact = candidates.filter(
    (c) => c.id === want || c.name.toLowerCase() === lower
  );
  const hits = exact.length
    ? exact
    : want.length >= 4
      ? candidates.filter((c) => c.id.startsWith(want))
      : [];
  if (hits.length === 1) return hits[0];
  if (hits.length > 1)
    throw new Error(
      `"${ref}" matches ${hits.length} tasks: ${hits.map((h) => `${h.name} (${h.id.slice(0, 8)})`).join(", ")}`
    );
  throw new Error(`No running or queued task matches "${ref}"`);
}

// How full the workspace's running-task limit is for this project.
export function slotState(projectId: string): {
  running: number;
  limit: number | null;
  full: boolean;
} {
  const workspaceId = workspaceOf(projectId);
  const limit = limitOf(workspaceId);
  if (!workspaceId || limit === null)
    return { running: 0, limit: null, full: false };
  const running =
    runningIn({ workspaceId, projectId }, true).length +
    startingIn(workspaceId);
  return { running, limit, full: running >= limit };
}

export const waitingIn = (workspaceId: string) =>
  (
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM task_queue q JOIN projects p ON p.id = q.project_id
         WHERE q.status = 'queued' AND p.workspace_id = ?
           AND q.after_task IS NULL AND q.after_any IS NULL
           AND q.plan_only IS NULL`
      )
      .get(workspaceId) as { n: number }
  ).n;

export const label = queuedLabel;

export function afterLabel(r: QueueRow): string | null {
  if (r.after_task) {
    const s = sessionOf(r.after_task);
    const q = s ? null : row(r.after_task);
    return s?.name ?? (q ? label(q) : r.after_task.slice(0, 8));
  }
  return r.after_any ? "any running task" : null;
}

// SQLite's datetime('now') is UTC without a zone.
export const sqliteMs = (v: string) =>
  Date.parse(v.includes("T") ? v : `${v.replace(" ", "T")}Z`) || 0;

export const groupKey = (workspaceId: string | null, projectId: string) =>
  workspaceId ?? `project:${projectId}`;

export function groupFor(
  workspaceId: string | null,
  projectId: string,
  startingRows: number
): Group {
  const scope = { workspaceId, projectId };
  return {
    inFlight:
      runningIn(scope, true).length +
      (workspaceId ? (reserved.get(workspaceId) ?? 0) : 0) +
      startingRows,
    limit: limitOf(workspaceId) ?? Number.POSITIVE_INFINITY,
  };
}

// Finishes other waiters have taken, so one finish lets one waiter go.
export const usedFinishes = (): string[] =>
  (
    db
      .prepare(
        `SELECT after_any_used AS id FROM task_queue WHERE after_any_used IS NOT NULL`
      )
      .all() as { id: string }[]
  ).map((x) => x.id);

export function lineSignature(): string {
  const r = db
    .prepare(
      `SELECT COUNT(*) AS n, COALESCE(MAX(position), 0) AS p,
              COALESCE(SUM(priority = 'normal'), 0) AS pr,
              (SELECT COUNT(*) FROM session_rows WHERE task_status IS NOT NULL
                 AND task_status NOT IN ('merged', 'dropped')) AS running
       FROM task_queue WHERE status IN ('queued', 'starting')`
    )
    .get() as { n: number; p: number; pr: number; running: number };
  return `${r.n}:${r.p}:${r.pr}:${r.running}`;
}
