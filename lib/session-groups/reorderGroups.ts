import { getDb } from "@/lib/db";
import { listGroups } from "./store";
import { GroupError, type SessionGroup } from "./types";

// Sets a workspace's group order. `ids` may name only some of them (a move
// up or down sends the whole list; a stale list from another device leaves
// newer groups at the end), but never one from another workspace.
export function reorderGroups(
  workspaceId: string | null,
  ids: unknown
): SessionGroup[] {
  if (!Array.isArray(ids) || ids.some((i) => typeof i !== "string"))
    throw new GroupError("invalid", "ids is a list of group ids");
  const current = listGroups(workspaceId);
  const known = new Set(current.map((g) => g.id));
  const wanted = [...new Set(ids as string[])];
  const stranger = wanted.find((i) => !known.has(i));
  if (stranger)
    throw new GroupError("workspace", "A group is not in this workspace");
  const order = [
    ...wanted,
    ...current.map((g) => g.id).filter((i) => !wanted.includes(i)),
  ];
  const db = getDb();
  const set = db.prepare(
    `UPDATE session_groups SET sort_order = ?, updated_at = datetime('now')
     WHERE id = ? AND sort_order != ?`
  );
  db.transaction(() => order.forEach((id, i) => set.run(i, id, i)))();
  return listGroups(workspaceId);
}
