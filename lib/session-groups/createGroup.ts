import { randomUUID } from "crypto";
import { getDb } from "@/lib/db";
import { cleanName, findGroup, groupByName } from "./store";
import { GroupError, type SessionGroup } from "./types";

// A new group goes to the bottom of its workspace's order. The name is
// unique within the workspace, ignoring case.
export function createGroup(
  workspaceId: string | null,
  name: unknown
): SessionGroup {
  const clean = cleanName(name);
  const db = getDb();
  if (
    workspaceId &&
    !db.prepare(`SELECT 1 FROM workspaces WHERE id = ?`).get(workspaceId)
  )
    throw new GroupError("not-found", "Workspace not found");
  if (groupByName(workspaceId, clean))
    throw new GroupError("duplicate", `There is already a group "${clean}"`);
  const id = randomUUID();
  db.prepare(
    `INSERT INTO session_groups (id, workspace_id, name, sort_order)
     VALUES (?, ?, ?, (SELECT COALESCE(MAX(sort_order) + 1, 0)
       FROM session_groups WHERE COALESCE(workspace_id, '') = COALESCE(?, '')))`
  ).run(id, workspaceId, clean, workspaceId);
  return findGroup(id)!;
}
