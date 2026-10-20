import { getDb } from "@/lib/db";
import { GroupError, NAME_MAX, type SessionGroup } from "./types";

interface GroupRow extends Omit<SessionGroup, "collapsed"> {
  collapsed: number;
  deleted_at: string | null;
}

const COLUMNS = `id, workspace_id, name, sort_order, collapsed, created_at,
  updated_at, deleted_at`;

const toGroup = ({ deleted_at: _, ...row }: GroupRow): SessionGroup => ({
  ...row,
  collapsed: !!row.collapsed,
});

export function cleanName(name: unknown): string {
  const trimmed =
    typeof name === "string" ? name.trim().replace(/\s+/g, " ") : "";
  if (!trimmed) throw new GroupError("invalid", "A group needs a name");
  if (trimmed.length > NAME_MAX)
    throw new GroupError(
      "invalid",
      `A group name is at most ${NAME_MAX} characters`
    );
  return trimmed;
}

// Live groups (not deleted), in the order to show them within a workspace.
export function listGroups(workspaceId?: string | null): SessionGroup[] {
  const rows = (
    workspaceId === undefined
      ? getDb()
          .prepare(
            `SELECT ${COLUMNS} FROM session_groups WHERE deleted_at IS NULL
             ORDER BY sort_order, created_at`
          )
          .all()
      : getDb()
          .prepare(
            `SELECT ${COLUMNS} FROM session_groups WHERE deleted_at IS NULL
               AND COALESCE(workspace_id, '') = COALESCE(?, '')
             ORDER BY sort_order, created_at`
          )
          .all(workspaceId)
  ) as GroupRow[];
  return rows.map(toGroup);
}

// Live groups' names by id, for labelling.
export function groupNames(): Map<string, string> {
  return new Map(listGroups().map((g) => [g.id, g.name]));
}

// Any group by id, deleted or not, with whether it is deleted.
export function findGroup(
  id: string
): (SessionGroup & { deleted: boolean }) | null {
  const row = getDb()
    .prepare(`SELECT ${COLUMNS} FROM session_groups WHERE id = ?`)
    .get(id) as GroupRow | undefined;
  return row ? { ...toGroup(row), deleted: !!row.deleted_at } : null;
}

// A live group by id, or the error a caller should surface.
export function liveGroup(id: unknown): SessionGroup {
  const group = typeof id === "string" ? findGroup(id) : null;
  if (!group) throw new GroupError("not-found", "Group not found");
  if (group.deleted) throw new GroupError("deleted", "That group was deleted");
  return group;
}

export function groupByName(
  workspaceId: string | null,
  name: string
): SessionGroup | null {
  const row = getDb()
    .prepare(
      `SELECT ${COLUMNS} FROM session_groups
       WHERE deleted_at IS NULL AND lower(name) = lower(?)
         AND COALESCE(workspace_id, '') = COALESCE(?, '')`
    )
    .get(name.trim(), workspaceId) as GroupRow | undefined;
  return row ? toGroup(row) : null;
}
