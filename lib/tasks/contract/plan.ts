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

import fs from "fs/promises";
import path from "path";
import { db, type Session } from "../../db";
import { isRemoteHost } from "../../hosts";
import { peerSource } from "../../hosts/peer-load";
import { hostLink, requireHostLink } from "../../hosts/remote-api";
import { LOCAL, machineCapabilities } from "../../load/machines";
import { implementArrived, planNoteFor } from "../../models/plan-step";
import { sessionWorkspace } from "../../models/resolve";
import { queueEvent } from "../../orchestrator/events";
import { brakesOn } from "../../orchestrator/brakes";
import { isPaused } from "../../orchestrator/pause";
import { getProject } from "../../projects";
import { planFor, splitOf } from "../../plans/features";
import { moveTask } from "../move-flow";
import * as client from "./client";
import { meetsNeeds, needsOf } from "../placement";
import { remotePlanPath } from "./plan-path";
import { DEFAULT_PRIORITY, isPriority } from "../schedule-types";
import { localHolds } from "../hold-checks";
import { expandHome } from "../session";
import { orchestratorOf } from "../starter";
import { setPlan } from "../../db/session-parts";

export { remotePlanPath };

const getSession = (id: string) =>
  db.prepare(`SELECT * FROM session_rows WHERE id = ?`).get(id) as
    Session | undefined;

async function readCopy(id: string): Promise<string | null> {
  try {
    return await fs.readFile(remotePlanPath(id), "utf8");
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

/**
 * A mirror that is planning, its machine's listing of it in hand: if its plan
 * is written there, copy it, say so, and carry on for a plan-first task.
 */
export async function planWritten(
  s: Session,
  view: { planReady?: boolean } | undefined
): Promise<void> {
  const link = hostLink(s.host_id);
  if (!link || !view?.planReady) return;
  const text = await client.plan(link, s.id);
  const claimed = setPlan(
    db,
    s.id,
    { plan_phase: "awaiting" },
    { plan_phase: "planning" }
  );
  if (!claimed) return;
  if (text !== null) {
    await fs.mkdir(path.dirname(remotePlanPath(s.id)), { recursive: true });
    await fs.writeFile(remotePlanPath(s.id), text);
  }
  const fresh = getSession(s.id)!;
  const split = checkedSplit(fresh, text);
  const errors = split?.errors ?? [];
  // As for a task planned here: a plan-first task goes on by itself, a
  // plan-only one waits unless no-approvals is on, and pieces that couldn't
  // be registered always hold it.
  const goOn = !fresh.plan_only && !errors.length;
  const target = goOn ? implementTarget(fresh, split) : null;
  const next =
    target === "there"
      ? `implementing on ${hostLink(s.host_id)?.hostName ?? "that machine"}`
      : target === "home"
        ? "moving here to implement once this machine is free"
        : "waiting for approval, not implementing (approve_plan to go ahead, drop to reject)";
  const note = planNoteFor(fresh, remotePlanPath(s.id), next);
  setPlan(db, s.id, { plan_note: note });
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
      (await import("../../notify/push/events")).pushPlanAwaiting(
        s.id,
        s.name,
        planned?.pieces.length ?? 1
      );
    } catch (e) {
      console.error("plan push failed:", e);
    }
    return;
  }
  await continuePlanThere(fresh);
}

/**
 * Carries a written plan on: approves it on the machine that planned it, or
 * hands it to the move home. Returns what it will implement on.
 */
export async function continuePlanThere(
  s: Session,
  message?: string
): Promise<string> {
  const link = requireHostLink(s.host_id!);
  const split = checkedSplit(s, await readCopy(s.id));
  if (implementTarget(s, split) === "there") {
    const out = await client.approvePlan(link, s.id, message);
    setPlan(
      db,
      s.id,
      { plan_phase: "implementing" },
      { plan_phase: "awaiting" }
    );
    client.forget(link.hostId);
    return out.model ?? link.hostName;
  }
  setPlan(
    db,
    s.id,
    { plan_phase: "handoff", plan_handoff_message: message ?? null },
    { plan_phase: "awaiting" }
  );
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

export const handingOff = new Set<string>();

export async function finishArrival(
  id: string,
  message?: string
): Promise<boolean> {
  await implementArrived(id, message || undefined);
  setPlan(db, id, { plan_handoff_message: null });
  return true;
}

// Fired, not awaited: a move takes minutes and the queue tick must not wait.
export function fire(id: string, run: () => Promise<unknown>) {
  if (handingOff.has(id)) return;
  void run().catch((e) => console.error(`Moving ${id} here failed:`, e));
}

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
  // What an orchestrator started stays under its Pause and brakes.
  const workspaceId = sessionWorkspace(s);
  if (workspaceId && orchestratorOf(s.started_by)) {
    if (isPaused(workspaceId)) return false;
    if ((await brakesOn(workspaceId)).length) return false;
  }
  const { needs } = needsOf({
    projectId: project.id,
    projectPath: expandHome(project.working_directory),
    prompt: s.task_prompt ?? "",
  });
  const holds = localHolds(
    {
      needs,
      priority: isPriority(s.priority) ? s.priority : DEFAULT_PRIORITY,
    },
    now
  );
  if (holds.length) return false;
  handingOff.add(id);
  try {
    const message = s.plan_handoff_message ?? undefined;
    const edits = s.plan_edits ?? null;
    const arrived = await moveTask(id, LOCAL);
    // The arrived row keeps the pending hand-off until implementing has
    // started, so a restart in between is picked up by syncMirrors.
    setPlan(db, arrived.id, {
      plan_edits: edits ?? undefined,
      plan_handoff_message: message ?? "",
    });
    handingOff.add(arrived.id);
    try {
      return await finishArrival(arrived.id, message);
    } finally {
      handingOff.delete(arrived.id);
    }
  } finally {
    handingOff.delete(id);
  }
}
