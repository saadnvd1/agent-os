/**
 * Tasks that can't move: one waiting on a person (an escalated gate or an
 * open ask), on a LumifyHub card, or in a stack. A task an orchestrator
 * started does move: its state is re-keyed to the new session (move-carry),
 * and the machine it lands on holds it for that orchestrator's device
 * (held.ts), so nothing there merges it.
 */

import { db, type Session } from "../db";
import { escalations } from "../orchestrator/gates";
import { taskSubject } from "../orchestrator/asks";

/** Started by an orchestrator, or held for one by the machine it left. */
export function isOrchestrated(session: Session): boolean {
  if (session.started_by || session.held_by_device) return true;
  return !!db
    .prepare(
      `SELECT 1 FROM orchestrator_starts WHERE kind != 'stack' AND target = ? LIMIT 1`
    )
    .get(session.id);
}

export function moveRefusal(session: Session): string | null {
  if (session.quick_of)
    return "It's a quick change its orchestrator makes on this machine, so it stays here";
  if (escalations(session.id).length)
    return "It's waiting on you (an escalated gate), so it stays here";
  if (session.plan_only && session.plan_phase !== "implementing")
    return "It's a plan-only task that hasn't been approved, so it stays here";
  const ask = db
    .prepare(
      `SELECT 1 FROM orchestrator_asks WHERE subject IN (?, ?) AND status = 'open' LIMIT 1`
    )
    .get(session.id, taskSubject(session.id));
  if (ask) return "It has an open ask waiting on you, so it stays here";
  const row = db
    .prepare(
      `SELECT lh_card_id,
         EXISTS (SELECT 1 FROM stack_items WHERE session_id = s.id) AS stacked
       FROM sessions s WHERE id = ?`
    )
    .get(session.id) as
    | { lh_card_id: string | null; stacked: number }
    | undefined;
  if (row?.lh_card_id) return "Card tasks run on this machine only for now";
  if (row?.stacked) return "Stacked tasks run on this machine only for now";
  return null;
}
