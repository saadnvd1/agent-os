/**
 * Tasks that can't move: one waiting on a person (an escalated gate or an
 * open ask), on a LumifyHub card, in a stack, or started by an orchestrator
 * (its brakes, ceiling and Pause count only what runs here). Their guard state is keyed
 * by this session and wouldn't follow it, so the other machine could merge
 * what's waiting on them.
 */

import { db, type Session } from "../db";
import { escalations } from "../orchestrator/gates";

export function moveRefusal(session: Session): string | null {
  if (session.view === "chat")
    return "Chat tasks run on this machine only for now";
  if (escalations(session.id).length)
    return "It's waiting on you (an escalated gate), so it stays here";
  const ask = db
    .prepare(
      `SELECT 1 FROM orchestrator_asks WHERE subject = ? AND status = 'open' LIMIT 1`
    )
    .get(session.id);
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
  const orchestrated = db
    .prepare(
      `SELECT 1 FROM orchestrator_starts WHERE kind != 'stack' AND target = ? LIMIT 1`
    )
    .get(session.id);
  if (orchestrated)
    return "An orchestrator's tasks run on this machine only for now";
  return null;
}
