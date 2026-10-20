import { getDb } from "@/lib/db";
import { resolveReadable, readerScope } from "@/lib/bus/read-scope";
import { assignSessions } from "./assignSessions";
import { createGroup } from "./createGroup";
import { listGroups } from "./store";
import { updateGroup } from "./updateGroup";
import { resolveGroup } from "./resolveGroup";
import { GroupError } from "./types";

export type GroupCommand =
  | { action: "list" }
  | { action: "new"; name: string }
  | { action: "rename"; group: string; name: string }
  | { action: "add"; group: string; sessions: string[] }
  | { action: "rm"; sessions: string[] };

// `aos group ...`: the caller's own workspace's groups, resolved the way
// `aos read` resolves sessions, so it reaches nothing outside that scope.
export function groupCommand(callerId: string, cmd: GroupCommand): string {
  const scope = readerScope(callerId);
  const ws = scope.workspaceId;
  if (cmd.action === "list") return describe(ws, scope.label);
  if (cmd.action === "new") {
    const g = createGroup(ws, cmd.name);
    return `created group "${g.name}" in your ${scope.label}`;
  }
  if (cmd.action === "rename") {
    const from = resolveGroup(ws, cmd.group);
    return `renamed "${from.name}" to "${updateGroup(from.id, { name: cmd.name }).name}"`;
  }
  if (!cmd.sessions.length)
    throw new GroupError("invalid", "Name at least one session");
  const target = cmd.action === "add" ? resolveGroup(ws, cmd.group) : null;
  const ids = cmd.sessions.map((ref) => {
    if (ref === "me") return callerId;
    const found = resolveReadable(callerId, ref);
    if (!found.ok) throw new GroupError("not-found", found.error);
    return found.session.id;
  });
  assignSessions(ids, target?.id ?? null);
  return target
    ? `put ${ids.length} session${ids.length === 1 ? "" : "s"} in "${target.name}"`
    : `took ${ids.length} session${ids.length === 1 ? "" : "s"} out of their group`;
}

function describe(workspaceId: string | null, label: string): string {
  const groups = listGroups(workspaceId);
  if (!groups.length) return `no groups in your ${label}`;
  const counts = new Map(
    (
      getDb()
        .prepare(
          `SELECT session_group_id AS id, COUNT(*) AS n FROM sessions
           WHERE session_group_id IS NOT NULL AND archived_at IS NULL
           GROUP BY session_group_id`
        )
        .all() as { id: string; n: number }[]
    ).map((r) => [r.id, r.n])
  );
  return groups.map((g) => `${g.name}  ·  ${counts.get(g.id) ?? 0}`).join("\n");
}
