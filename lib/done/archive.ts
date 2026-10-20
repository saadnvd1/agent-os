// Archived sessions: out of the sidebar, the needs-you count and the
// orchestrator's view, but kept with their history and chat items.

import fs from "fs";
import { db, queries, type Session } from "../db";
import { statusOf } from "../orchestrator/facts";
import { kickWaits } from "../bus/waits/kick";
import { peerSessionLink } from "../hosts/peer-actions";

export interface ArchivedView {
  id: string;
  name: string;
  projectId: string | null;
  projectName: string | null;
  workspaceId: string | null;
  view: Session["view"];
  taskStatus: Session["task_status"];
  branch: string | null;
  prUrl: string | null;
  // The worktree done kept because it held work, or that it removed.
  keptWorktree: string | null;
  worktreeRemoved: boolean;
  archivedAt: string;
}

export function archiveSession(id: string): void {
  db.prepare(
    `UPDATE sessions SET archived_at = datetime('now') WHERE id = ? AND archived_at IS NULL`
  ).run(id);
  kickWaits();
}

export function unarchiveSession(id: string): Session {
  const changed = db
    .prepare(
      `UPDATE sessions SET archived_at = NULL WHERE id = ? AND archived_at IS NOT NULL`
    )
    .run(id).changes;
  const row = db.prepare(`SELECT * FROM session_rows WHERE id = ?`).get(id) as
    Session | undefined;
  if (!row) throw new Error("Session not found");
  if (!changed) throw new Error(`${row.name} isn't archived`);
  return row;
}

// Newest first; in one workspace when given.
export function listArchived(workspaceId?: string): ArchivedView[] {
  const rows = db
    .prepare(
      `SELECT s.id, s.name, s.project_id, s.view, s.task_status, s.branch_name,
         s.pr_url, s.worktree_path, s.archived_at, p.name AS project_name, p.workspace_id AS project_workspace
       FROM session_rows s LEFT JOIN projects p ON p.id = s.project_id
       WHERE s.archived_at IS NOT NULL
         AND (? IS NULL OR p.workspace_id = ?)
       ORDER BY s.archived_at DESC, s.updated_at DESC`
    )
    .all(workspaceId ?? null, workspaceId ?? null) as (Session & {
    project_name: string | null;
    project_workspace: string | null;
  })[];
  return rows.map((s) => ({
    id: s.id,
    name: s.name,
    projectId: s.project_id,
    projectName: s.project_name,
    workspaceId: s.project_workspace,
    view: s.view,
    taskStatus: s.task_status,
    branch: s.branch_name,
    prUrl: s.pr_url,
    keptWorktree:
      s.worktree_path && fs.existsSync(s.worktree_path)
        ? s.worktree_path
        : null,
    worktreeRemoved: !!s.worktree_path && !fs.existsSync(s.worktree_path),
    archivedAt: s.archived_at!,
  }));
}

// Puts a session away on purpose. Nothing is merged or stopped here: an
// agent still working, a task with an open PR and an orchestrator stay.
export async function archiveChecked(id: string): Promise<Session> {
  const s = queries.getSession(db).get(id) as Session | undefined;
  if (!s) throw new Error("Session not found");
  if (s.archived_at) throw new Error(`${s.name} is already archived`);
  if (s.role === "orchestrator")
    throw new Error(
      `${s.name} is a workspace's orchestrator; it can't be archived`
    );
  if (peerSessionLink(s))
    throw new Error(`${s.name} runs on another machine: archive it there`);
  if (s.task_status === "running" && s.pr_status === "open")
    throw new Error(
      `${s.name} has an open PR: Done it first, which merges it through the gates`
    );
  if ((await statusOf(s)).status === "running")
    throw new Error(
      `${s.name} is still working: wait for it, or stop it first`
    );
  archiveSession(s.id);
  return queries.getSession(db).get(id) as Session;
}
