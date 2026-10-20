import { db } from "../db";
import type { Session } from "../db";
import { getProject } from "../projects";
import { getWorkspace } from "../workspaces";
import { previousNames } from "../session-names";
import { resolveRef, type Candidate } from "./resolve";

export type ReadableSession = Session & { project_name: string | null };

export interface ReaderScope {
  workspaceId: string | null;
  projectId: string | null;
  label: string;
}

// What the asking session may read: its workspace, or its project when it
// has none. The boundary the orchestrator's tools use.
export function readerScope(callerId: string): ReaderScope {
  const caller = db
    .prepare(`SELECT * FROM session_rows WHERE id = ?`)
    .get(callerId) as Session | undefined;
  if (!caller) throw new Error("aos read runs from inside an AgentOS session");
  const project = caller.project_id ? getProject(caller.project_id) : null;
  const workspaceId =
    caller.workspace_id ?? (project && project.workspace_id) ?? null;
  if (workspaceId)
    return {
      workspaceId,
      projectId: null,
      label: `workspace ${getWorkspace(workspaceId)?.name ?? workspaceId}`,
    };
  if (!project || project.is_uncategorized)
    throw new Error(`${caller.name} isn't in a project`);
  return {
    workspaceId: null,
    projectId: project.id,
    label: `project ${project.name}`,
  };
}

const SELECT = `SELECT s.*, p.name AS project_name FROM session_rows s
  LEFT JOIN projects p ON p.id = s.project_id
  WHERE s.peer_mirror = 0 AND s.held_by_device IS NULL`;

const isLive = (s: Session) =>
  !s.archived_at && (!s.task_status || s.task_status === "running");

function candidates(rows: ReadableSession[]): Candidate[] {
  const old = previousNames();
  return rows.map((s) => ({
    id: s.id,
    name: s.name,
    projectName: s.project_name,
    tmuxName: s.tmux_name,
    previousNames: old.get(s.id) ?? [],
  }));
}

function inScope(s: ReadableSession, scope: ReaderScope): boolean {
  if (s.role) return false;
  if (scope.workspaceId) {
    const p = s.project_id ? getProject(s.project_id) : null;
    // A session in no project is in the workspace it was started in.
    return (p?.workspace_id ?? s.workspace_id) === scope.workspaceId;
  }
  return s.project_id === scope.projectId;
}

export type Readable =
  | { ok: true; session: ReadableSession; note?: string }
  | { ok: false; external: boolean; error: string };

// A session in the caller's scope by name, old name, project/name, id or id
// prefix. Done, dropped and archived ones count, but a live session wins a
// name over a finished one.
export function resolveReadable(callerId: string, ref: string): Readable {
  const scope = readerScope(callerId);
  const all = (db.prepare(SELECT).all() as ReadableSession[]).sort((a, b) =>
    a.updated_at < b.updated_at ? 1 : -1
  );
  const mine = all.filter((s) => inScope(s, scope));
  let none = "";
  for (const group of [mine.filter(isLive), mine.filter((s) => !isLive(s))]) {
    const r = resolveRef(ref, candidates(group));
    if (r.ok) {
      const session = group.find((s) => s.id === r.id)!;
      if (session.id === callerId)
        return { ok: false, external: false, error: "that's this session" };
      return { ok: true, session, note: r.note };
    }
    if (r.reason === "ambiguous")
      return { ok: false, external: false, error: r.error };
    none = r.error;
  }
  const other = resolveRef(
    ref,
    candidates(all.filter((s) => !mine.includes(s)))
  );
  if (other.ok) {
    const s = all.find((x) => x.id === other.id)!;
    return {
      ok: false,
      external: false,
      error: s.role
        ? `${s.name} is an orchestrator: it isn't readable. Message it with aos send`
        : `"${ref}" isn't in your ${scope.label}; aos read reaches only sessions there`,
    };
  }
  return { ok: false, external: true, error: `${none}. Run: aos peers` };
}
