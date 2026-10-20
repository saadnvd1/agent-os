import { getDb } from "@/lib/db";
import { liveGroup } from "./store";
import { sessionWorkspaceId } from "./workspace";
import { GroupError, type SessionGroup } from "./types";

// The one place that checks the invariant: a session joins only a group of
// its own workspace. Membership is a view choice, so it leaves updated_at
// alone, like pinning.
export function checkMember(sessionId: string, group: SessionGroup): void {
  const workspaceId = sessionWorkspaceId(sessionId);
  if (workspaceId === undefined)
    throw new GroupError("not-found", "Session not found");
  if ((workspaceId ?? null) !== (group.workspace_id ?? null))
    throw new GroupError(
      "workspace",
      `"${group.name}" is a group of another workspace`
    );
}

// Files sessions into a group, or out of any (groupId null). All or none.
export function assignSessions(
  sessionIds: readonly string[],
  groupId: string | null
): { moved: number } {
  const ids = [...new Set(sessionIds)];
  const group = groupId === null ? null : liveGroup(groupId);
  const db = getDb();
  return db.transaction(() => {
    let moved = 0;
    for (const id of ids) {
      if (group) checkMember(id, group);
      else if (sessionWorkspaceId(id) === undefined)
        throw new GroupError("not-found", "Session not found");
      moved += db
        .prepare(
          `UPDATE sessions SET session_group_id = ?
           WHERE id = ? AND session_group_id IS NOT ?`
        )
        .run(group?.id ?? null, id, group?.id ?? null).changes;
    }
    return { moved };
  })();
}

// For a session that is starting: its group may have been deleted, or its
// workspace changed, since it was asked for. Starting must not fail over a
// view choice, so it just starts ungrouped.
export function fileInGroup(sessionId: string, groupId: string): void {
  try {
    assignSessions([sessionId], groupId);
  } catch (err) {
    if (!(err instanceof GroupError)) throw err;
  }
}

// A new session starts in the group of the one it came from (a worker from its
// conductor, a fork or a fresh start from its source), when that group is
// still live and in the new session's workspace.
export function inheritGroup(fromSessionId: string, toSessionId: string): void {
  const row = getDb()
    .prepare(`SELECT session_group_id AS id FROM sessions WHERE id = ?`)
    .get(fromSessionId) as { id: string | null } | undefined;
  if (row?.id) fileInGroup(toSessionId, row.id);
}

// Leaving a workspace leaves its groups (a project move into another one).
export function clearForeignGroup(sessionId: string): string | null {
  const row = getDb()
    .prepare(
      `SELECT g.id AS id, g.name AS name, g.workspace_id AS ws
       FROM sessions s JOIN session_groups g ON g.id = s.session_group_id
       WHERE s.id = ?`
    )
    .get(sessionId) as
    { id: string; name: string; ws: string | null } | undefined;
  if (!row || (sessionWorkspaceId(sessionId) ?? null) === row.ws) return null;
  getDb()
    .prepare(`UPDATE sessions SET session_group_id = NULL WHERE id = ?`)
    .run(sessionId);
  return row.name;
}
