/**
 * What an orchestrator's acting tools may touch: only its own workspace's
 * projects, sessions, tasks and stacks. Every lookup here refuses a target
 * anywhere else, by saying it isn't in this workspace.
 */

import { db, stackQueries, type Project, type Session } from "../db";
import { getWorkspace } from "../workspaces";
import { workspaceProjects } from "./brief";
import { findWorkspaceSession } from "./read";

const lower = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();

function workspaceName(workspaceId: string): string {
  return getWorkspace(workspaceId)?.name ?? "this workspace";
}

// A project of this workspace by name or id; with boards, by board name too.
export function workspaceProject(
  workspaceId: string,
  ref: string,
  opts: { boards?: boolean } = {}
): Project {
  const r = lower(ref);
  if (!r) throw new Error("Say which project");
  const projects = workspaceProjects(workspaceId);
  const byName = projects.filter((p) => p.id === ref || lower(p.name) === r);
  const matches = byName.length
    ? byName
    : opts.boards
      ? projects.filter(
          (p) => lower(p.lh_board_name) === r || p.lh_board_id === ref
        )
      : [];
  if (matches.length === 1) return matches[0];
  if (matches.length > 1)
    throw new Error(`"${ref}" matches ${matches.length} projects; use the id`);
  const names = projects.map((p) => p.name).join(", ") || "none";
  throw new Error(
    `No project "${ref}" in ${workspaceName(workspaceId)} (its projects: ${names}). The orchestrator acts only inside its workspace.`
  );
}

// A PR given as 12, #12 or a pull URL.
export function prNumberOf(ref: string): number | null {
  const m = /^#?(\d+)$/.exec(ref.trim()) ?? /\/pull\/(\d+)/.exec(ref);
  return m ? Number(m[1]) : null;
}

// A task of this workspace by session ref, or by its PR.
export function workspaceTask(
  workspaceId: string,
  ref: string
): Session & { project_name: string } {
  const pr = prNumberOf(ref);
  if (pr !== null) {
    const rows = db
      .prepare(
        `SELECT s.*, p.name AS project_name FROM sessions s
         JOIN projects p ON p.id = s.project_id
         WHERE p.workspace_id = ? AND s.pr_number = ? AND s.task_status IS NOT NULL
         ORDER BY s.created_at DESC`
      )
      .all(workspaceId, pr) as (Session & { project_name: string })[];
    if (rows.length === 1) return rows[0];
    if (rows.length > 1)
      throw new Error(
        `PR #${pr} is a task in ${rows.length} projects here; name the task`
      );
  }
  const session = findWorkspaceSession(workspaceId, ref);
  if (!session.task_status)
    throw new Error(`${session.name} is a session, not a task`);
  return session;
}

// A stack on one of this workspace's projects, by id, id prefix or name.
export function workspaceStack(workspaceId: string, ref: string) {
  const r = lower(ref);
  const ids = new Set(workspaceProjects(workspaceId).map((p) => p.id));
  const stacks = stackQueries
    .all(db)
    .filter((s) => ids.has(s.project_id))
    .filter(
      (s) =>
        s.id === ref ||
        (r.length >= 6 && s.id.startsWith(r)) ||
        lower(s.name) === r
    );
  // A name can repeat across runs: the newest is meant.
  if (stacks.length) return stacks[0];
  throw new Error(
    `No stack "${ref}" in ${workspaceName(workspaceId)}. Call sessions to see stack positions.`
  );
}
