// Archived sessions: out of the sidebar, the needs-you count and the
// orchestrator's view, but kept with their history and chat items.

import fs from "fs";
import { db, type Session } from "../db";

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
  // The worktree done kept because it held work.
  keptWorktree: string | null;
  archivedAt: string;
}

export function archiveSession(id: string): void {
  db.prepare(
    `UPDATE sessions SET archived_at = datetime('now') WHERE id = ? AND archived_at IS NULL`
  ).run(id);
}

export function unarchiveSession(id: string): Session {
  const changed = db
    .prepare(
      `UPDATE sessions SET archived_at = NULL WHERE id = ? AND archived_at IS NOT NULL`
    )
    .run(id).changes;
  const row = db.prepare(`SELECT * FROM sessions WHERE id = ?`).get(id) as
    | Session
    | undefined;
  if (!row) throw new Error("Session not found");
  if (!changed) throw new Error(`${row.name} isn't archived`);
  return row;
}

// Newest first; in one workspace when given.
export function listArchived(workspaceId?: string): ArchivedView[] {
  const rows = db
    .prepare(
      `SELECT s.*, p.name AS project_name, p.workspace_id AS project_workspace
       FROM sessions s LEFT JOIN projects p ON p.id = s.project_id
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
    archivedAt: s.archived_at!,
  }));
}
