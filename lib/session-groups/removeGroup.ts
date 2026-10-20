import { getDb } from "@/lib/db";
import { findGroup, groupByName, liveGroup } from "./store";
import { GroupError, type SessionGroup } from "./types";

// Soft delete: members keep their session_group_id and the sidebar ignores a
// deleted group, so they fall back to the status shelves and Undo (restore)
// puts them back. Nothing is hard-deleted.
export function deleteGroup(id: string): SessionGroup {
  const group = liveGroup(id);
  getDb()
    .prepare(
      `UPDATE session_groups SET deleted_at = datetime('now'),
         updated_at = datetime('now') WHERE id = ?`
    )
    .run(id);
  return group;
}

export function restoreGroup(id: string): SessionGroup {
  const group = findGroup(id);
  if (!group) throw new GroupError("not-found", "Group not found");
  if (!group.deleted) return group;
  // A new group took the name meanwhile.
  if (groupByName(group.workspace_id, group.name))
    throw new GroupError(
      "duplicate",
      `There is already a group "${group.name}"`
    );
  getDb()
    .prepare(
      `UPDATE session_groups SET deleted_at = NULL,
         updated_at = datetime('now') WHERE id = ?`
    )
    .run(id);
  return liveGroup(id);
}
