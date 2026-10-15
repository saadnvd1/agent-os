/**
 * Tasks that run on another machine's AgentOS. That machine schedules them;
 * this one keeps a mirror row (same id, the host's id) so the sidebar lists
 * them and the terminal attaches through that machine's AgentOS.
 */

import { db, type Project, type Session } from "../../db";
import { isRemoteHost } from "../../hosts";
import { requireHostLink } from "../../hosts/remote-api";
import { orchestratedStart } from "../held";
import { projectRef } from "../project-ref";
import { orchestratorOf } from "../starter";
import type { TaskStatus } from "../state";
import * as client from "./client";

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
    await client.requireCapability(
      link,
      "held-start",
      "an orchestrator's task",
      "hold"
    );
  if (plan)
    await client.requireCapability(link, "remote-plan", "a plan step", "plan");
  const { session } = await client.start(link, {
    project: await projectRef(project),
    ...rest,
    ...(plan && {
      plan: true,
      plan_only: true,
      plan_waits: true,
      plan_reason: plan.reason ?? undefined,
    }),
    orchestrated: startedBy ? orchestratedStart(startedBy) : undefined,
  });
  mirrorTask(hostId, project.id, session, startedBy);
  if (plan)
    db.prepare(
      `UPDATE sessions SET plan_phase = 'planning', plan_only = ?, plan_decided = 1,
         plan_reason = ?, plan_waits_for_caller = 1 WHERE id = ?`
    ).run(plan.only ? 1 : null, plan.reason, session.id);
  client.forget(hostId);
  return db
    .prepare(`SELECT * FROM sessions WHERE id = ?`)
    .get(session.id) as Session;
}

export function setMirrorStatus(id: string, status: TaskStatus): void {
  db.prepare(
    `UPDATE sessions SET task_status = ? WHERE id = ? AND task_status = 'running'`
  ).run(status, id);
}
