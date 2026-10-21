// The operating mode: a workspace default and a per-task override. Manual
// until someone says otherwise. The developer-analyst loop reads it here.

import { db } from "../db";
import { isMode, type OperatingMode } from "./types";

export interface ModeOf {
  mode: OperatingMode;
  source: "task" | "workspace" | "default";
}

const read = (
  scope: "task" | "workspace",
  id: string
): OperatingMode | null => {
  const row = db
    .prepare(
      `SELECT mode FROM operating_modes WHERE scope = ? AND scope_id = ?`
    )
    .get(scope, id) as { mode: string } | undefined;
  return row && isMode(row.mode) ? row.mode : null;
};

export function workspaceOf(sessionId: string): string | null {
  const row = db
    .prepare(`SELECT workspace_id FROM session_rows WHERE id = ?`)
    .get(sessionId) as { workspace_id: string | null } | undefined;
  return row?.workspace_id ?? null;
}

export function modeOf(sessionId: string): ModeOf {
  const own = read("task", sessionId);
  if (own) return { mode: own, source: "task" };
  const ws = workspaceOf(sessionId);
  const inherited = ws ? read("workspace", ws) : null;
  return inherited
    ? { mode: inherited, source: "workspace" }
    : { mode: "manual", source: "default" };
}

export const workspaceMode = (workspaceId: string): OperatingMode =>
  read("workspace", workspaceId) ?? "manual";

// null clears the task's override so it follows its workspace again.
function put(
  scope: "task" | "workspace",
  id: string,
  mode: OperatingMode | null
) {
  if (mode === null) {
    db.prepare(
      `DELETE FROM operating_modes WHERE scope = ? AND scope_id = ?`
    ).run(scope, id);
    return;
  }
  db.prepare(
    `INSERT INTO operating_modes (scope, scope_id, mode) VALUES (?, ?, ?)
     ON CONFLICT(scope, scope_id) DO UPDATE SET mode = excluded.mode, updated_at = datetime('now')`
  ).run(scope, id, mode);
}

export const setTaskMode = (sessionId: string, mode: OperatingMode | null) =>
  put("task", sessionId, mode);
export const setWorkspaceMode = (id: string, mode: OperatingMode) =>
  put("workspace", id, mode);
