/** Sessions that ended (dropped, done, archived) and can be asked for back. */

import { db } from "../db";
import { resolveRef } from "../bus/resolve";

export type EndedKind = "dropped" | "done" | "archived" | "settled";

export interface EndedSession {
  id: string;
  name: string;
  projectId: string | null;
  projectName: string | null;
  kind: EndedKind;
  taskStatus: string | null;
  // A plan-only task whose plan was written and never approved.
  planWaiting: boolean;
  endedAt: string;
}

// A workspace's, or one project's, or everyone's (a person's own shell).
export type EndedScope = { workspaceId: string } | { projectId: string } | null;

interface Row {
  id: string;
  name: string;
  tmux_name: string;
  project_id: string | null;
  project_name: string | null;
  task_status: string | null;
  archived_at: string | null;
  plan_phase: string | null;
  ended_at: string;
}

function kindOf(r: Row): EndedKind {
  if (r.task_status === "dropped") return "dropped";
  if (r.archived_at) return "archived";
  return r.task_status === "done" ? "done" : "settled";
}

function rows(scope: EndedScope, limit: number, kind?: EndedKind): Row[] {
  const where = [
    "s.role IS NULL",
    "s.peer_mirror = 0",
    "s.held_by_device IS NULL",
  ];
  const args: (string | number)[] = [];
  if (scope && "workspaceId" in scope) {
    where.push("p.workspace_id = ?");
    args.push(scope.workspaceId);
  } else if (scope) {
    where.push("s.project_id = ?");
    args.push(scope.projectId);
  }
  where.push(
    `(s.archived_at IS NOT NULL OR s.task_status IN ('dropped', 'done')
       OR (s.task_status IS NULL AND s.settled_at IS NOT NULL))`
  );
  if (kind === "dropped") where.push("s.task_status = 'dropped'");
  if (kind === "archived") where.push("s.archived_at IS NOT NULL");
  if (kind === "done")
    where.push("s.task_status = 'done' AND s.archived_at IS NULL");
  return db
    .prepare(
      `SELECT s.id, s.name, s.tmux_name, s.project_id, p.name AS project_name,
         s.task_status, s.archived_at, s.plan_phase,
         COALESCE(s.task_ended_at, s.archived_at, s.settled_at, s.updated_at) AS ended_at
       FROM session_rows s LEFT JOIN projects p ON p.id = s.project_id
       WHERE ${where.join(" AND ")}
       ORDER BY ended_at DESC LIMIT ?`
    )
    .all(...args, limit) as Row[];
}

export function endedSessions(
  scope: EndedScope,
  opts: { limit?: number; kind?: EndedKind } = {}
): EndedSession[] {
  return rows(scope, opts.limit ?? 50, opts.kind).map((r) => ({
    id: r.id,
    name: r.name,
    projectId: r.project_id,
    projectName: r.project_name,
    kind: kindOf(r),
    taskStatus: r.task_status,
    planWaiting: r.plan_phase === "awaiting",
    endedAt: r.ended_at,
  }));
}

/** An ended session by name, project/name, id or id prefix, within the scope. */
export function resolveEnded(ref: string, scope: EndedScope): string {
  const all = rows(scope, 500);
  const r = resolveRef(
    ref,
    all.map((s) => ({
      id: s.id,
      name: s.name,
      projectName: s.project_name,
      tmuxName: s.tmux_name,
      previousNames: [],
    }))
  );
  if (!r.ok)
    throw new Error(
      r.reason === "none"
        ? `No dropped, done or archived session "${ref}"${scope ? " here" : ""}.`
        : r.error
    );
  return r.id;
}
