/**
 * Which live session a name someone typed reaches, across workspaces.
 */

import { db, type Session } from "../db";
import { getProject } from "../projects";
import { getWorkspace } from "../workspaces";
import { previousNames } from "../session-names";
import { sessionWorkspace } from "../schedules/store";
import { heldTarget } from "./held-reply";
import { resolveRef, type Candidate } from "./resolve";
import { resolveRoleAlias, roleAliasOf } from "./role-alias";

export function liveSessions(): Session[] {
  return db
    .prepare(
      `SELECT * FROM session_rows WHERE (task_status IS NULL OR task_status = 'running')
         AND archived_at IS NULL
       ORDER BY updated_at DESC`
    )
    .all() as Session[];
}

export function candidates(sessions: Session[]): Candidate[] {
  const old = previousNames();
  const workspaces = new Map<string | null, string | null>();
  const workspaceName = (s: Session) => {
    const id = sessionWorkspace(s);
    if (!workspaces.has(id))
      workspaces.set(id, id ? (getWorkspace(id)?.name ?? null) : null);
    return workspaces.get(id) ?? null;
  };
  return sessions.map((s) => ({
    id: s.id,
    name: s.name,
    projectName: s.project_id ? (getProject(s.project_id)?.name ?? null) : null,
    tmuxName: s.tmux_name,
    previousNames: old.get(s.id) ?? [],
    workspaceName: workspaceName(s),
    orchestrator: s.role === "orchestrator",
  }));
}

export const sessionById = (id: string | null | undefined) =>
  id
    ? (db.prepare(`SELECT * FROM session_rows WHERE id = ?`).get(id) as
        Session | undefined)
    : undefined;

// The orchestrator a held caller's ref names, if it names it.
export function resolveHeldOrchestrator(callerId: string, ref: string) {
  return heldTarget(sessionById(callerId), ref);
}

// A live session by name, old name, project/name, id or id prefix. The note
// says when the name meant something other than its current owner.
export function resolveTarget(
  ref: string,
  callerId?: string | null
): {
  session: Session;
  note?: string;
} {
  const found = tryResolveTarget(ref, callerId);
  if (!found.ok) throw new Error(found.error);
  return found;
}

// "orchestrator" / "my orchestrator": the caller's own workspace orchestrator.
function ownOrchestrator(
  ref: string,
  sessions: Session[],
  callerId?: string | null
): Session | undefined {
  if (!/^(my )?orchestrator$/i.test(ref.trim())) return undefined;
  const caller = sessionById(callerId);
  const workspace = caller ? sessionWorkspace(caller) : null;
  if (!workspace) return undefined;
  return sessions.find(
    (s) => s.role === "orchestrator" && s.workspace_id === workspace
  );
}

export function tryResolveTarget(
  ref: string,
  callerId?: string | null
):
  | { ok: true; session: Session; note?: string }
  | { ok: false; none: boolean; error: string } {
  const sessions = liveSessions();
  const alias = roleAliasOf(ref);
  if (alias) return resolveRoleAlias(alias, sessions, sessionById(callerId));
  const own = ownOrchestrator(ref, sessions, callerId);
  if (own) return { ok: true, session: own };
  const r = resolveRef(ref, candidates(sessions));
  if (!r.ok) {
    const orchestrators = /^(my )?orchestrator$/i.test(ref.trim())
      ? sessions.filter((s) => s.role === "orchestrator")
      : [];
    if (orchestrators.length)
      return {
        ok: false,
        none: true,
        error: `You are in no workspace, so "${ref}" is ambiguous. Use <workspace>/orchestrator: ${orchestrators
          .map(
            (s) =>
              `${getWorkspace(s.workspace_id ?? "")?.name ?? "?"}/orchestrator (${s.name}, id ${s.id.slice(0, 8)})`
          )
          .join(", ")}`,
      };
    return {
      ok: false,
      none: r.reason === "none",
      error: r.reason === "none" ? `${r.error}. Run: aos peers` : r.error,
    };
  }
  return {
    ok: true,
    session: sessions.find((s) => s.id === r.id)!,
    note: r.note,
  };
}

export function resolveSession(ref: string): Session {
  return resolveTarget(ref).session;
}
