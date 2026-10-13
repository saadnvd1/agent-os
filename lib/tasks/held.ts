/**
 * A task an orchestrator moved here belongs to that orchestrator's machine:
 * only the device that sent it may merge, arm, move, message or finish it.
 * Without this a moved task would be a plain task here, merged by anyone with
 * a green CI, past the gates its orchestrator judges it by.
 */

import { db, type Session } from "../db";

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
