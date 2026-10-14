/**
 * A task an orchestrator moved here belongs to that orchestrator's machine:
 * only the device that sent it may merge, arm, move, message or finish it.
 * Without this a moved task would be a plain task here, merged by anyone with
 * a green CI, past the gates its orchestrator judges it by.
 */

import os from "os";
import { db, type Session } from "../db";
import type { OrchestratedBundle } from "./move-bundle";

export function holderRefusal(
  session: Pick<Session, "held_by_device" | "held_from">,
  device: string | null | undefined
): string | null {
  if (!session.held_by_device) return null;
  if (device && device === session.held_by_device) return null;
  return `Its orchestrator on ${session.held_from || "another machine"} decides this; do it from there`;
}

/** The refusal for the task with this id, or null (also when it's unknown). */
export function heldRefusal(
  id: string,
  device: string | null | undefined
): string | null {
  const session = db
    .prepare(`SELECT held_by_device, held_from FROM sessions WHERE id = ?`)
    .get(id) as Pick<Session, "held_by_device" | "held_from"> | undefined;
  return session ? holderRefusal(session, device) : null;
}

/** Holds a task here for the paired device that sent it, and the orchestrator there. */
export function holdFor(
  id: string,
  holder: string,
  held: {
    heldFrom: string;
    orchestrator?: { id: string; name: string };
    since?: string | null;
  }
): void {
  db.prepare(
    `UPDATE sessions SET held_by_device = ?, held_from = ?, held_for = ?, held_for_name = ?,
       task_since = COALESCE(?, task_since) WHERE id = ?`
  ).run(
    holder,
    held.heldFrom,
    held.orchestrator?.id ?? null,
    held.orchestrator?.name ?? null,
    held.since ?? null,
    id
  );
}

/**
 * What a linked machine needs to hold a task this machine's orchestrator
 * starts there: the same description a move carries, minus work already done.
 */
export function orchestratedStart(
  startedBy: string,
  since: string | null = new Date().toISOString()
): OrchestratedBundle {
  const o = db
    .prepare(`SELECT name FROM sessions WHERE id = ?`)
    .get(startedBy) as { name: string } | undefined;
  return {
    heldFrom: os.hostname(),
    since,
    modelProvider: null,
    modelOverrides: null,
    planPhase: null,
    planFile: null,
    orchestrator: o ? { id: startedBy, name: o.name } : undefined,
  };
}

/** Stands in for a starter nobody recorded: tasks already running when starters began to be recorded. */
const UNRECORDED_STARTER = "unrecorded";

/** Records the paired device that started a task here, the only one that may later hold it. */
export function recordStarter(id: string, device: string): void {
  db.prepare(`UPDATE sessions SET started_by_device = ? WHERE id = ?`).run(
    device,
    id
  );
}

type Holdable = Pick<
  Session,
  | "held_by_device"
  | "started_by"
  | "started_by_device"
  | "task_status"
  | "host_id"
  | "task_prompt"
>;

/**
 * Whether `device` may hold this task: a running task on this machine that
 * nobody here (an orchestrator or a person) owns, which that device started.
 */
export function mayHold(s: Holdable, device: string): boolean {
  if (!s.task_prompt || s.task_status !== "running") return false;
  if (s.host_id && s.host_id !== "local") return false;
  if (s.started_by || s.held_by_device) return false;
  return (
    s.started_by_device === device || s.started_by_device === UNRECORDED_STARTER
  );
}

/**
 * Holds a task already running here for the device that started it, and the
 * orchestrator there. False when there's no such running task; a task this
 * device didn't start, one an orchestrator here owns, or one another device
 * holds is refused. Holding the same task again is a no-op.
 */
export function holdExisting(
  id: string,
  device: string,
  held: Parameters<typeof holdFor>[2]
): boolean {
  const s = db
    .prepare(
      `SELECT held_by_device, started_by, started_by_device, task_status, host_id, task_prompt
       FROM sessions WHERE id = ?`
    )
    .get(id) as Holdable | undefined;
  if (!s?.task_prompt || s.task_status !== "running") return false;
  if (s.held_by_device === device) return true;
  if (!mayHold(s, device))
    throw new Error("Only the machine that started this task can hold it");
  holdFor(id, device, held);
  return true;
}
