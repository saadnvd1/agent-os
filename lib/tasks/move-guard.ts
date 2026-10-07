/**
 * Tasks that can't move: one waiting on a person (an escalated gate or an
 * open ask), on a LumifyHub card, or in a stack. Their guard state is keyed
 * by this session and wouldn't follow it, so the other machine could merge
 * what's waiting on them.
 */

import { db, type Session } from "../db";
import { escalations } from "../orchestrator/gates";

export function moveRefusal(session: Session): string | null {
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
  return null;
}
