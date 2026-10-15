/**
 * Tasks that run on another machine's AgentOS. That machine schedules them;
 * this one keeps a mirror row (same id, the host's id) so the sidebar lists
 * them and the terminal attaches through that machine's AgentOS, and asks it for their
 * state, sign-off and drop.
 */

import { MERGE_METHODS, type MergeMethod } from "./merge-methods";
import { db, type Project, type Session } from "../db";
import {
  HostApiError,
  hostApi,
  requireHostLink,
  type HostLink,
} from "../hosts/remote-api";
import { isRemoteHost } from "../hosts";
import { projectRef } from "./project-ref";
import { orchestratedStart } from "./held";
import type { TaskStatus } from "./state";
import type { TaskView } from "./index";
import { orchestratorOf } from "./starter";

// What this machine's task API does, for another machine deciding whether
// it can trust it with a pinned merge or a move; keyed-start: a session
// start takes a key, so it's safe to retry (lib/sessions/launch.ts).
export const TASK_CAPABILITIES = [
  "pinned-merge",
  "move",
  "chat-turn",
  "keyed-start",
  "chat-move",
  // Holds an orchestrator's task for the machine that sent it, and answers
  // its messages, reads, stops and done (lib/tasks/held.ts).
  "orchestrated-move",
  // A held task's chat facts and its messages for its orchestrator.
  "held-chat-facts",
  "held-replies",
  // A keyed start that carries an orchestrator's description holds the task
  // for the device that sent it, as a move does (lib/tasks/held.ts).
  "held-start",
  // A plan placed here by another machine stops at the plan for that machine
  // to decide what follows (lib/tasks/remote-plan.ts).
  "remote-plan",
] as const;

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
  remote: Session,
  startedBy?: string | null
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
  // What carryTaskState gives a moved task's mirror: the orchestrator that
  // holds it, and when it began (so its PR is judged from then).
  if (startedBy)
    db.prepare(
      `UPDATE sessions SET started_by = COALESCE(started_by, ?),
         task_since = COALESCE(task_since, created_at) WHERE id = ?`
    ).run(startedBy, remote.id);
}

/**
 * A machine on an older AgentOS would take a chat task as a terminal one,
 * or an orchestrator's task as a plain one that anyone there could merge, or
 * refuse to hand one over.
 */
export async function requireCapability(
  link: HostLink,
  capability: string,
  what: string,
  verb = "move"
): Promise<void> {
  const { capabilities = [] } = await hostTasks(link, true).catch((err) => {
    throw new Error(
      `Can't ask ${link.hostName} whether it takes ${what}: ${(err as Error).message}`
    );
  });
  if (!capabilities.includes(capability))
    throw new Error(
      `${link.hostName}'s AgentOS can't ${verb} ${what} yet; update it first`
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
    // The orchestrator that started it: that machine holds the task for it.
    startedBy?: string | null;
    // It plans first: there it plans, stops, and waits for this machine.
    plan?: { only: boolean; reason: string | null };
  }
): Promise<Session> {
  const link = requireHostLink(hostId);
  const { startedBy: by, plan, ...rest } = opts;
  const startedBy = orchestratorOf(by);
  if (startedBy)
    await requireCapability(
      link,
      "held-start",
      "an orchestrator's task",
      "hold"
    );
  if (plan) await requireCapability(link, "remote-plan", "a plan step", "plan");
  const { session } = await postIdempotent<{ session: Session }>(
    link,
    "/api/tasks",
    {
      project: await projectRef(project),
      ...rest,
      ...(plan && {
        plan: true,
        plan_only: true,
        plan_waits: true,
        plan_reason: plan.reason ?? undefined,
      }),
      orchestrated: startedBy ? orchestratedStart(startedBy) : undefined,
    },
    180000
  );
  mirrorTask(hostId, project.id, session, startedBy);
  if (plan)
    db.prepare(
      `UPDATE sessions SET plan_phase = 'planning', plan_only = ?, plan_decided = 1,
         plan_reason = ?, plan_waits_for_caller = 1 WHERE id = ?`
    ).run(plan.only ? 1 : null, plan.reason, session.id);
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

/**
 * Sign off or drop on the machine that runs it. A merge returns the method
 * that machine merged with; null when it doesn't say (an older AgentOS).
 */
export async function remoteTaskAction(
  session: Session,
  action: "merge" | "drop",
  head?: string,
  base?: string | null
): Promise<MergeMethod | null> {
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
  // base: what the gates here were judged against; the machine that merges
  // compares the PR with it, not with a base only it recorded.
  const res = await hostApi<{ head?: string | null; method?: unknown }>(
    link,
    `/api/tasks/${encodeURIComponent(session.id)}/${action}`,
    {
      body: { ...(head && { head }), ...(head && base && { base }) },
      timeout: 300000,
    }
  ).catch(async (err) => {
    if (action !== "merge" || !unknownOutcome(err)) throw err;
    // A proxy or a dropped connection after the merge ran answers 502 with
    // nothing from AgentOS: ask what state the task is in before failing.
    const merged = await hostTasks(link, true)
      .then((l) => l.tasks.find((t) => t.id === session.id)?.state === "merged")
      .catch(() => false);
    if (!merged)
      throw new Error(
        `${(err as Error).message}: couldn't confirm whether ${link.hostName} merged ${session.name}; check its PR before signing off again`
      );
    return { head: head ?? null, method: undefined };
  });
  forgetHostTasks(link.hostId);
  setMirrorStatus(session.id, action === "merge" ? "merged" : "dropped");
  if (head && res.head !== head)
    throw new Error(
      `${link.hostName} merged without confirming it was ${head.slice(0, 7)}`
    );
  return MERGE_METHODS.find((m) => m === res.method) ?? null;
}
