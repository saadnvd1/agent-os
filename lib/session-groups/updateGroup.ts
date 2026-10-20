import { getDb } from "@/lib/db";
import { cleanName, groupByName, liveGroup } from "./store";
import { GroupError, type SessionGroup } from "./types";

// Rename and fold. Folding is stored here so every device agrees.
export function updateGroup(
  id: string,
  patch: { name?: unknown; collapsed?: unknown }
): SessionGroup {
  const group = liveGroup(id);
  const sets: string[] = [];
  const args: (string | number)[] = [];
  if (patch.name !== undefined) {
    const clean = cleanName(patch.name);
    const clash = groupByName(group.workspace_id, clean);
    if (clash && clash.id !== id)
      throw new GroupError("duplicate", `There is already a group "${clean}"`);
    sets.push("name = ?");
    args.push(clean);
  }
  if (patch.collapsed !== undefined) {
    if (typeof patch.collapsed !== "boolean")
      throw new GroupError("invalid", "collapsed must be a boolean");
    sets.push("collapsed = ?");
    args.push(patch.collapsed ? 1 : 0);
  }
  if (sets.length)
    getDb()
      .prepare(
        `UPDATE session_groups SET ${sets.join(", ")},
           updated_at = datetime('now') WHERE id = ?`
      )
      .run(...args, id);
  return liveGroup(id);
}
