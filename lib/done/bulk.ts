/**
 * Done for every idle or stopped session in a project or a workspace, each
 * judged on its own: what was done, what kept its worktree, what was
 * refused and why.
 */

import { db, type Session } from "../db";
import { getProject } from "../projects";
import { workspaceProjects } from "../orchestrator/brief";
import { statusOf } from "../orchestrator/facts";
import { statusDetector } from "../status-detector";
import { doneSession, type DoneOptions, type DoneOutcome } from "./index";

export type DoneScope = { workspaceId: string } | { projectId: string };

export interface BulkResult {
  done: DoneOutcome[];
  refused: { id: string; name: string; reason: string }[];
  summary: string;
}

// The sidebar's sessions in scope: not archived, no orchestrator, no
// finished task.
function scopeSessions(scope: DoneScope): Session[] {
  const projectIds =
    "workspaceId" in scope
      ? workspaceProjects(scope.workspaceId).map((p) => p.id)
      : [scope.projectId];
  if (!projectIds.length) return [];
  return db
    .prepare(
      `SELECT * FROM sessions
       WHERE project_id IN (${projectIds.map(() => "?").join(", ")})
         AND role IS NULL AND archived_at IS NULL
         AND (task_status IS NULL OR task_status = 'running')
       ORDER BY created_at`
    )
    .all(...projectIds) as Session[];
}

// Idle or stopped: nothing working, nothing waiting on an answer.
export async function idleSessions(
  scope: DoneScope,
  callerId?: string | null
): Promise<Session[]> {
  await statusDetector.refreshCache();
  const all = scopeSessions(scope).filter((s) => s.id !== callerId);
  const states = await Promise.all(all.map((s) => statusOf(s)));
  return all.filter(
    (_, i) => states[i].status === "idle" || states[i].status === "dead"
  );
}

// The caller's workspace when its project has one, else its project.
export function scopeOf(session: Session): DoneScope {
  const project = session.project_id ? getProject(session.project_id) : null;
  if (!project || project.is_uncategorized)
    throw new Error(`${session.name} isn't in a project`);
  return project.workspace_id
    ? { workspaceId: project.workspace_id }
    : { projectId: project.id };
}

export function bulkSummary(r: Omit<BulkResult, "summary">): string {
  if (!r.done.length && !r.refused.length)
    return "No idle sessions to clean up.";
  const kept = r.done.filter((d) => d.worktree.action === "kept");
  const lines = [
    `Done: ${r.done.length}, kept a worktree: ${kept.length}, refused: ${r.refused.length}.`,
    ...r.done.map((d) => `  done     ${d.text}`),
    ...r.refused.map((x) => `  refused  ${x.name}: ${x.reason}`),
  ];
  return lines.join("\n");
}

// One at a time: merges and worktree removals touch the same repositories.
export async function doneIdle(
  scope: DoneScope,
  opts: DoneOptions
): Promise<BulkResult> {
  const result: Omit<BulkResult, "summary"> = { done: [], refused: [] };
  for (const s of await idleSessions(scope, opts.callerId)) {
    try {
      result.done.push(await doneSession(s.id, opts));
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      result.refused.push({ id: s.id, name: s.name, reason });
    }
  }
  return { ...result, summary: bulkSummary(result) };
}
