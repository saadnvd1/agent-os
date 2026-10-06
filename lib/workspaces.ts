/**
 * Workspaces group projects in the sidebar (e.g. Work / Personal). They are
 * presentation only: deleting one leaves its projects ungrouped.
 */

import { randomUUID } from "crypto";
import { db, type Workspace } from "./db";

type WorkspaceRow = Omit<Workspace, "collapsed"> & { collapsed: number };

const toWorkspace = (row: WorkspaceRow): Workspace => ({
  ...row,
  collapsed: !!row.collapsed,
});

export function listWorkspaces(): Workspace[] {
  return (
    db
      .prepare(`SELECT * FROM workspaces ORDER BY sort_order, created_at`)
      .all() as WorkspaceRow[]
  ).map(toWorkspace);
}

export function getWorkspace(id: string): Workspace | null {
  const row = db.prepare(`SELECT * FROM workspaces WHERE id = ?`).get(id) as
    | WorkspaceRow
    | undefined;
  return row ? toWorkspace(row) : null;
}

export function createWorkspace(name: string): Workspace {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Name is required");
  const id = randomUUID();
  const { max } = db
    .prepare(`SELECT COALESCE(MAX(sort_order), 0) AS max FROM workspaces`)
    .get() as { max: number };
  db.prepare(
    `INSERT INTO workspaces (id, name, sort_order) VALUES (?, ?, ?)`
  ).run(id, trimmed, max + 1);
  return getWorkspace(id)!;
}

export function updateWorkspace(
  id: string,
  updates: { name?: string; collapsed?: boolean; sortOrder?: number }
): Workspace | null {
  const existing = getWorkspace(id);
  if (!existing) return null;
  const name = updates.name?.trim() || existing.name;
  db.prepare(
    `UPDATE workspaces SET name = ?, collapsed = ?, sort_order = ? WHERE id = ?`
  ).run(
    name,
    (updates.collapsed ?? existing.collapsed) ? 1 : 0,
    updates.sortOrder ?? existing.sort_order,
    id
  );
  return getWorkspace(id);
}

export function deleteWorkspace(id: string): void {
  db.transaction(() => {
    db.prepare(
      `UPDATE projects SET workspace_id = NULL WHERE workspace_id = ?`
    ).run(id);
    db.prepare(`DELETE FROM workspaces WHERE id = ?`).run(id);
    // Its orchestrator goes with it; a running worker idles out on its own.
    db.prepare(
      `DELETE FROM sessions WHERE role = 'orchestrator' AND workspace_id = ?`
    ).run(id);
    db.prepare(`DELETE FROM orchestrator_events WHERE workspace_id = ?`).run(
      id
    );
  })();
}

export function setProjectWorkspace(
  projectId: string,
  workspaceId: string | null
): void {
  if (workspaceId && !getWorkspace(workspaceId)) {
    throw new Error("Unknown workspace");
  }
  db.prepare(
    `UPDATE projects SET workspace_id = ? WHERE id = ? AND is_uncategorized = 0`
  ).run(workspaceId, projectId);
}
