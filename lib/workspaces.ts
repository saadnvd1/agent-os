/**
 * Workspaces group projects in the sidebar (e.g. Work / Personal). They are
 * presentation only: deleting one leaves its projects ungrouped.
 */

import { randomUUID } from "crypto";
import { db, type Workspace } from "./db";
import { clearForeignGroup } from "./session-groups/assignSessions";

type WorkspaceRow = Omit<
  Workspace,
  "collapsed" | "wake_tasks_on_pr" | "orch_mcp_servers" | "orch_full_access"
> & {
  collapsed: number;
  wake_tasks_on_pr: number;
  orch_full_access: number;
  orch_mcp_servers: string;
};

function parseServers(raw: string): string[] {
  try {
    const list = JSON.parse(raw);
    return Array.isArray(list)
      ? list.filter((n): n is string => typeof n === "string")
      : [];
  } catch {
    return [];
  }
}

// A list of server names: trimmed, deduplicated, none empty.
function serverNames(value: unknown, current: string[]): string[] {
  if (value === undefined) return current;
  if (!Array.isArray(value) || value.some((n) => typeof n !== "string"))
    throw new Error("mcpServers is a list of server names");
  return [...new Set(value.map((n: string) => n.trim()).filter(Boolean))];
}

const toWorkspace = (row: WorkspaceRow): Workspace => ({
  ...row,
  collapsed: !!row.collapsed,
  wake_tasks_on_pr: !!row.wake_tasks_on_pr,
  orch_full_access: !!row.orch_full_access,
  orch_mcp_servers: parseServers(row.orch_mcp_servers),
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
    WorkspaceRow | undefined;
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

// A limit on running tasks: a whole number from 1, or null for none.
function taskLimit(value: unknown, current: number | null): number | null {
  if (value === undefined) return current;
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1)
    throw new Error("The running task limit is a whole number from 1, or none");
  return value;
}

export function updateWorkspace(
  id: string,
  updates: {
    name?: string;
    collapsed?: boolean;
    sortOrder?: number;
    maxRunningTasks?: number | null;
    wakeTasksOnPR?: boolean;
    orchFullAccess?: boolean;
    mcpServers?: string[];
  }
): Workspace | null {
  const existing = getWorkspace(id);
  if (!existing) return null;
  const name = updates.name?.trim() || existing.name;
  db.prepare(
    `UPDATE workspaces SET name = ?, collapsed = ?, sort_order = ?, max_running_tasks = ?, wake_tasks_on_pr = ?, orch_full_access = ?, orch_mcp_servers = ? WHERE id = ?`
  ).run(
    name,
    (updates.collapsed ?? existing.collapsed) ? 1 : 0,
    updates.sortOrder ?? existing.sort_order,
    taskLimit(updates.maxRunningTasks, existing.max_running_tasks),
    (updates.wakeTasksOnPR ?? existing.wake_tasks_on_pr) ? 1 : 0,
    (updates.orchFullAccess ?? existing.orch_full_access) ? 1 : 0,
    JSON.stringify(serverNames(updates.mcpServers, existing.orch_mcp_servers)),
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
    // Sessions filed here by being started here go back to "All workspaces".
    db.prepare(
      `UPDATE sessions SET workspace_id = NULL
       WHERE role IS NULL AND workspace_id = ?`
    ).run(id);
    // Its orchestrator goes with it; a running worker idles out on its own.
    db.prepare(
      `DELETE FROM sessions WHERE role = 'orchestrator' AND workspace_id = ?`
    ).run(id);
    for (const table of [
      "orchestrator_events",
      "orchestrator_event_log",
      "orchestrator_asks",
    ])
      db.prepare(`DELETE FROM ${table} WHERE workspace_id = ?`).run(id);
  })();
}

// A project's sessions follow it, so moving one needs no change to them.
export function setProjectWorkspace(
  projectId: string,
  workspaceId: string | null
): void {
  if (workspaceId && !getWorkspace(workspaceId)) {
    throw new Error("Unknown workspace");
  }
  db.transaction(() => {
    db.prepare(
      `UPDATE projects SET workspace_id = ? WHERE id = ? AND is_uncategorized = 0`
    ).run(workspaceId, projectId);
    // Its sessions changed workspace, so they leave the old one's groups.
    const ids = db
      .prepare(`SELECT id FROM sessions WHERE project_id = ?`)
      .all(projectId) as { id: string }[];
    for (const { id } of ids) clearForeignGroup(id);
  })();
}
