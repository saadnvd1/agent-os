/**
 * A plan placed on a linked machine (queue placement, remote.ts). Planning
 * only reads code, so it runs wherever there is room; what follows the plan
 * is decided here, on the machine whose scheduler, needs and workspace apply.
 * The other machine plans, stops, and waits. This machine then copies the
 * plan, says it is written, and either approves it there (the task is built
 * where it planned) or moves the task here once this machine can take it
 * (it needs a Mac, or its plan is split into pieces, which register here).
 * Moving the task reuses the ordinary move (move-flow.ts).
 */

import fs from "fs";
import path from "path";
import { db, type Session } from "../db";
import { isRemoteHost } from "../hosts";
import { peerSource } from "../hosts/peer-load";
import { hostApi, hostLink, requireHostLink } from "../hosts/remote-api";
import { LOCAL, localView, machineCapabilities } from "../load/machines";
import { noApprovalsOn, recordAutoApproval } from "../approvals/no-approvals";
import { implementArrived, planNoteFor } from "../models/plan-step";
import { sessionWorkspace } from "../models/resolve";
import { queueEvent } from "../orchestrator/events";
import { getProject } from "../projects";
import { planFor, splitOf } from "../plans/features";
import { forgetHostTasks, hostTasks } from "./remote";
import { moveTask } from "./move-flow";
import { heavyNeeds, meetsNeeds, needsOf } from "./placement";
import { remotePlanPath } from "./remote-plan-path";
import { DEFAULT_PRIORITY, isPriority } from "./schedule-types";
import { machineHold } from "./schedule";
import { expandHome } from "./session";
import { orchestratorOf } from "./starter";

export { remotePlanPath };

const getSession = (id: string) =>
  db.prepare(`SELECT * FROM sessions WHERE id = ?`).get(id) as
    | Session
    | undefined;

function readCopy(id: string): string | null {
  try {
    return fs.readFileSync(remotePlanPath(id), "utf8");
  } catch {
    return null;
  }
}

function checkedSplit(s: Session, text: string | null) {
  try {
    return text ? splitOf(s, text) : null;
  } catch {
    return null;
  }
}

/**
 * Where a written plan is built: "there" (approved on the machine that
 * planned it) or "home" (moved here first). Pieces are checked against this
 * machine's projects, and work that needs a Mac can't be built on a machine
 * without one, so those come home; everything else stays where it is, since
 * the machine that planned it is the one with room.
 */
export function implementTarget(
  s: Session,
  split: ReturnType<typeof splitOf>
): "there" | "home" {
  const project = s.project_id ? getProject(s.project_id) : null;
  // The project lives there: nothing here to build it in.
  if (!project || isRemoteHost(project.host_id)) return "there";
  if (split) return "home";
  const { needs } = needsOf({
    projectId: project.id,
    projectPath: expandHome(project.working_directory),
    prompt: s.task_prompt ?? "",
  });
  const caps = peerSource(s.host_id!, Date.now()).capabilities;
  if (meetsNeeds(needs, caps)) return "there";
  return meetsNeeds(needs, machineCapabilities()) ? "home" : "there";
}

// One look at a mirror that is planning: if its plan is written there, copy
// it, say so, and carry on for a plan-first task.
async function planWritten(s: Session): Promise<void> {
  const link = hostLink(s.host_id);
  if (!link) return;
  const view = await hostTasks(link)
    .then(({ tasks }) => tasks.find((t) => t?.id === s.id))
    .catch(() => undefined);
  if (!view?.planReady) return;
  const { text } = await hostApi<{ text: string | null }>(
    link,
    `/api/tasks/${encodeURIComponent(s.id)}/plan`,
    { timeout: 30000 }
  );
  const claimed = db
    .prepare(
      `UPDATE sessions SET plan_phase = 'awaiting' WHERE id = ? AND plan_phase = 'planning'`
    )
    .run(s.id).changes;
  if (!claimed) return;
  if (text !== null) {
    fs.mkdirSync(path.dirname(remotePlanPath(s.id)), { recursive: true });
    fs.writeFileSync(remotePlanPath(s.id), text);
  }
  const fresh = getSession(s.id)!;
  const split = checkedSplit(fresh, text);
  const errors = split?.errors ?? [];
  // As for a task planned here: a plan-first task goes on by itself, a
  // plan-only one waits unless no-approvals is on, and pieces that couldn't
  // be registered always hold it.
  const auto = !!fresh.plan_only && noApprovalsOn();
  const goOn = (!fresh.plan_only || auto) && !errors.length;
  const target = goOn ? implementTarget(fresh, split) : null;
  const next =
    target === "there"
      ? `implementing on ${hostLink(s.host_id)?.hostName ?? "that machine"}`
      : target === "home"
        ? "moving here to implement once this machine is free"
        : "waiting for approval, not implementing (approve_plan to go ahead, drop to reject)";
  const note = planNoteFor(fresh, remotePlanPath(s.id), next);
  db.prepare(`UPDATE sessions SET plan_note = ? WHERE id = ?`).run(note, s.id);
  const workspaceId = sessionWorkspace(fresh);
  if (orchestratorOf(fresh.started_by) && workspaceId) {
    queueEvent(workspaceId, `plan-done:${s.id}`, s.id, note);
    if (errors.length)
      queueEvent(
        workspaceId,
        `plan-pieces:${s.id}`,
        s.id,
        `Plan of "${s.name}": couldn't register its pieces: ${errors.join("; ")}. It is held, not building. Message the task to fix the plan, or approve_plan to build it as one piece.`
      );
  }
  if (!goOn) {
    try {
      const planned = text ? planFor(fresh, text) : null;
      (await import("../notify/push/events")).pushPlanAwaiting(
        s.id,
        s.name,
        planned?.pieces.length ?? 1
      );
    } catch (e) {
      console.error("plan push failed:", e);
    }
    return;
  }
  await continueRemotePlan(fresh);
  if (auto)
    recordAutoApproval({
      source: "plan",
      workspaceId,
      sessionId: s.id,
      subject: `plan for ${s.name}`,
      detail: "implementing without waiting for approve_plan",
    });
}

/**
 * Carries a written plan on: approves it on the machine that planned it, or
 * hands it to the move home. Returns what it will implement on.
 */
export async function continueRemotePlan(
  s: Session,
  message?: string
): Promise<string> {
  const link = requireHostLink(s.host_id!);
  const split = checkedSplit(s, readCopy(s.id));
  if (implementTarget(s, split) === "there") {
    const out = await hostApi<{ model?: string }>(
      link,
      `/api/tasks/${encodeURIComponent(s.id)}/approve-plan`,
      { body: message ? { message } : {}, timeout: 60000 }
    );
    db.prepare(
      `UPDATE sessions SET plan_phase = 'implementing' WHERE id = ? AND plan_phase = 'awaiting'`
    ).run(s.id);
    forgetHostTasks(link.hostId);
    return out.model ?? link.hostName;
  }
  db.prepare(
    `UPDATE sessions SET plan_phase = 'handoff', plan_handoff_message = ?
     WHERE id = ? AND plan_phase = 'awaiting'`
  ).run(message ?? null, s.id);
  const workspaceId = sessionWorkspace(s);
  if (orchestratorOf(s.started_by) && workspaceId)
    queueEvent(
      workspaceId,
      `plan-handoff:${s.id}`,
      s.id,
      `Task "${s.name}": plan approved; it moves here to be built once this machine is free (${split ? "its plan is in pieces" : "it needs this machine"}).`
    );
  void handoffHome(s.id).catch((e) =>
    console.error(`Moving ${s.id} here failed:`, e)
  );
  return "this machine, once it is free";
}

const handingOff = new Set<string>();

/**
 * Moves an approved plan's task here, when this machine can take it, and
 * starts implementing. False while the machine is loaded (tried again on the
 * next look) or another call has it.
 */
export async function handoffHome(
  id: string,
  now = Date.now()
): Promise<boolean> {
  const s = getSession(id);
  if (!s || s.plan_phase !== "handoff" || !isRemoteHost(s.host_id))
    return false;
  if (handingOff.has(id)) return false;
  const project = s.project_id ? getProject(s.project_id) : null;
  if (!project) return false;
  const { needs } = needsOf({
    projectId: project.id,
    projectPath: expandHome(project.working_directory),
    prompt: s.task_prompt ?? "",
  });
  const hold = machineHold(
    {
      heavy: heavyNeeds(needs),
      needsUnmet: !meetsNeeds(needs, machineCapabilities()),
      remote: false,
      priority: isPriority(s.priority) ? s.priority : DEFAULT_PRIORITY,
    },
    localView(now),
    now
  );
  if (hold) return false;
  handingOff.add(id);
  try {
    const message = s.plan_handoff_message ?? undefined;
    const edits = s.plan_edits ?? null;
    const arrived = await moveTask(id, LOCAL);
    if (edits)
      db.prepare(`UPDATE sessions SET plan_edits = ? WHERE id = ?`).run(
        edits,
        arrived.id
      );
    await implementArrived(arrived.id, message);
    return true;
  } finally {
    handingOff.delete(id);
  }
}

/** Every mirror whose plan is being written, or approved and coming here. */
export async function syncRemotePlans(): Promise<void> {
  const rows = db
    .prepare(
      `SELECT * FROM sessions
       WHERE plan_waits_for_caller = 1 AND plan_phase IN ('planning', 'handoff')
         AND task_status = 'running' AND archived_at IS NULL`
    )
    .all() as Session[];
  for (const s of rows) {
    if (!isRemoteHost(s.host_id)) continue;
    try {
      if (s.plan_phase === "planning") await planWritten(s);
      else await handoffHome(s.id);
    } catch (e) {
      console.error(`Plan on ${s.host_id} for ${s.id} failed:`, e);
    }
  }
}
