/**
 * Tasks that run on another machine's AgentOS. That machine schedules them;
 * this one keeps a mirror row (same id, the host's id) so the sidebar lists
 * them and the terminal attaches through that machine's AgentOS, and asks it for their
 * state, sign-off and drop.
 */

import { db, type Project, type Session } from "../db";
import {
  HostApiError,
  hostApi,
  requireHostLink,
  type HostLink,
} from "../hosts/remote-api";
import { isRemoteHost } from "../hosts";
import { projectRef } from "./project-ref";
import type { TaskStatus } from "./state";
import type { TaskView } from "./index";

// What this machine's task API does, for another machine deciding whether
// it can trust it with a pinned merge or a move.
export const TASK_CAPABILITIES = ["pinned-merge", "move", "chat-turn"] as const;

export interface HostTasks {
  tasks: TaskView[];
  moved?: { id: string; movedTo: string | null }[];
  capabilities?: string[];
}

export function isMirror(session: Session): boolean {
  return isRemoteHost(session.host_id);
}

export function mirrorTask(
  hostId: string,
  projectId: string | null,
  remote: Session
): void {
  db.prepare(
    `INSERT INTO sessions (id, name, tmux_name, working_directory, model, group_path,
       agent_type, auto_approve, project_id, host_id, worktree_path, branch_name,
       base_branch, task_prompt, task_status, name_source, view)
     VALUES (?, ?, ?, ?, ?, 'sessions', 'claude', 1, ?, ?, ?, ?, ?, ?, 'running', 'user', ?)
     ON CONFLICT(id) DO NOTHING`
  ).run(
    remote.id,
    remote.name,
    remote.tmux_name,
    remote.working_directory,
    remote.model,
    projectId,
    hostId,
    remote.worktree_path,
    remote.branch_name,
    remote.base_branch,
    remote.task_prompt,
    // As that machine runs it: one that predates chat tasks says terminal.
    remote.view === "chat" ? "chat" : "terminal"
  );
}

export const unknownOutcome = (err: unknown) =>
  err instanceof HostApiError && !err.refused;

/** POST a call that's safe to repeat; once more if we can't tell it landed. */
export async function postIdempotent<T>(
  link: HostLink,
  path: string,
  body: unknown,
  timeout: number
): Promise<T> {
  try {
    return await hostApi<T>(link, path, { body, timeout });
  } catch (err) {
    if (!unknownOutcome(err)) throw err;
    return hostApi<T>(link, path, { body, timeout });
  }
}

export async function startRemoteTask(
  hostId: string,
  project: Project,
  opts: {
    id: string;
    prompt: string;
    name?: string;
    model?: string;
    baseBranch?: string;
    view?: "chat" | "terminal";
  }
): Promise<Session> {
  const link = requireHostLink(hostId);
  const { session } = await postIdempotent<{ session: Session }>(
    link,
    "/api/tasks",
    { project: await projectRef(project), ...opts },
    180000
  );
  mirrorTask(hostId, project.id, session);
  forgetHostTasks(hostId);
  return db
    .prepare(`SELECT * FROM sessions WHERE id = ?`)
    .get(session.id) as Session;
}

const cache = new Map<string, { at: number; list: Promise<HostTasks> }>();

export function hostTasks(link: HostLink, fresh = false): Promise<HostTasks> {
  const hit = cache.get(link.hostId);
  if (!fresh && hit && Date.now() - hit.at < 3000) return hit.list;
  const list = hostApi<HostTasks>(link, "/api/tasks", { timeout: 8000 });
  cache.set(link.hostId, { at: Date.now(), list });
  list.catch(() => cache.delete(link.hostId));
  return list;
}

export const forgetHostTasks = (hostId: string) => cache.delete(hostId);

export function setMirrorStatus(id: string, status: TaskStatus): void {
  db.prepare(
    `UPDATE sessions SET task_status = ? WHERE id = ? AND task_status = 'running'`
  ).run(status, id);
}

/** Sign off or drop on the machine that runs it. */
export async function remoteTaskAction(
  session: Session,
  action: "merge" | "drop",
  head?: string
): Promise<void> {
  const link = requireHostLink(session.host_id);
  // An AgentOS that predates pinned merges would ignore the head and merge
  // whatever the PR is at: refuse before asking it.
  if (head) {
    const { capabilities = [] } = await hostTasks(link, true);
    if (!capabilities.includes("pinned-merge"))
      throw new Error(
        `${link.hostName}'s AgentOS can't pin a merge to a commit; update it first`
      );
  }
  const res = await hostApi<{ head?: string | null }>(
    link,
    `/api/tasks/${encodeURIComponent(session.id)}/${action}`,
    { body: head ? { head } : {}, timeout: 300000 }
  );
  forgetHostTasks(link.hostId);
  setMirrorStatus(session.id, action === "merge" ? "merged" : "dropped");
  if (head && res.head !== head)
    throw new Error(
      `${link.hostName} merged without confirming it was ${head.slice(0, 7)}`
    );
}
