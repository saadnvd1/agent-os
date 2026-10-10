/**
 * Clean-up: done for every idle or stopped session in a project or a
 * workspace, each judged on its own. It never merges: a session with an
 * open PR is listed for its own done, which merges through the gates.
 * The preview says what will happen to each before anything does.
 */

import { db, type Session } from "../db";
import { getProject } from "../projects";
import { workspaceProjects } from "../orchestrator/brief";
import { statusOf } from "../orchestrator/facts";
import { statusDetector } from "../status-detector";
import { doneSession, type DoneOptions, type DoneOutcome } from "./index";
import { planDone, planLine } from "./plan";

export type DoneScope = { workspaceId: string } | { projectId: string };

type Named = { id: string; name: string };

export interface BulkResult {
  done: DoneOutcome[];
  refused: (Named & { reason: string })[];
  // Open PRs: each needs its own done, through the gates.
  mergeable: (Named & { pr: number })[];
  summary: string;
}

export interface PreviewRow extends Named {
  action: "cleanup" | "merge" | "refuse";
  // Its worktree goes (cleanup only).
  removesWorktree: boolean;
  line: string;
}

// Project ids a scope covers.
export function scopeProjectIds(scope: DoneScope): string[] {
  return "workspaceId" in scope
    ? workspaceProjects(scope.workspaceId).map((p) => p.id)
    : [scope.projectId];
}

export const inScope = (scope: DoneScope, s: Session) =>
  !!s.project_id && scopeProjectIds(scope).includes(s.project_id);

// The sidebar's sessions in scope: not archived, no orchestrator, no
// finished task.
function scopeSessions(scope: DoneScope): Session[] {
  const projectIds = scopeProjectIds(scope);
  if (!projectIds.length) return [];
  return db
    .prepare(
      `SELECT * FROM sessions
       WHERE project_id IN (${projectIds.map(() => "?").join(", ")})
         AND role IS NULL AND archived_at IS NULL
         -- A linked machine's own sessions are cleaned up there.
         AND peer_mirror = 0
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

// What a clean-up would do with each idle session; changes nothing.
export async function previewIdle(
  scope: DoneScope,
  callerId?: string | null
): Promise<PreviewRow[]> {
  const rows: PreviewRow[] = [];
  for (const s of await idleSessions(scope, callerId)) {
    const plan = await planDone(s, callerId);
    rows.push({
      id: s.id,
      name: s.name,
      action: plan.action,
      removesWorktree:
        plan.action === "cleanup" && plan.worktree.action === "remove",
      line: planLine(plan),
    });
  }
  return rows;
}

export function bulkSummary(r: Omit<BulkResult, "summary">): string {
  if (!r.done.length && !r.refused.length && !r.mergeable.length)
    return "No idle sessions to clean up.";
  const kept = r.done.filter((d) => d.worktree.action === "kept");
  const lines = [
    `Done: ${r.done.length}, kept a worktree: ${kept.length}, refused: ${r.refused.length}, open PRs left for their own done: ${r.mergeable.length}.`,
    ...r.done.map((d) => `  done     ${d.text}`),
    ...r.refused.map((x) => `  refused  ${x.name}: ${x.reason}`),
    ...r.mergeable.map(
      (x) =>
        `  open PR  ${x.name}: PR #${x.pr}, not merged by a clean-up; aos done ${x.name} merges it through the gates`
    ),
  ];
  return lines.join("\n");
}

// One at a time: worktree removals touch the same repositories.
export async function doneIdle(
  scope: DoneScope,
  opts: DoneOptions
): Promise<BulkResult> {
  const result: Omit<BulkResult, "summary"> = {
    done: [],
    refused: [],
    mergeable: [],
  };
  for (const s of await idleSessions(scope, opts.callerId)) {
    try {
      const plan = await planDone(s, opts.callerId);
      if (plan.action === "merge") {
        result.mergeable.push({ id: s.id, name: s.name, pr: plan.pr.number });
        continue;
      }
      result.done.push(await doneSession(s.id, { ...opts, noMerge: true }));
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      result.refused.push({ id: s.id, name: s.name, reason });
    }
  }
  return { ...result, summary: bulkSummary(result) };
}
