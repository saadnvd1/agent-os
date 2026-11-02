// A lead message the loop guard held. It's stored with the owner's ask
// (one ask per held message) and settled when the ask is answered: an
// approval delivers it once through the normal mail path, a decline drops
// it and tells the sender. The claim below makes either happen only once.

import { db } from "@/lib/db";
import { openBySubject, type AskRow } from "../orchestrator/asks";
import { sendMail } from "./mail";
import { tellLead } from "./deliver";
import type { LeadKind } from "./types";

const PREFIX = "lead-thread:";

export const heldSubject = (threadSubject: string, heldId: number) =>
  `${threadSubject}:${heldId}`;

export interface HeldMail {
  workspaceId: string;
  fromKind: LeadKind;
  toKind: LeadKind;
  thread: string;
  text: string;
  pins: number[];
  senderSessionId: string;
}

export function storeHeld(m: HeldMail): number {
  return Number(
    db
      .prepare(
        `INSERT INTO lead_held_mail (workspace_id, from_kind, to_kind, thread, text, pins, sender_session_id)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        m.workspaceId,
        m.fromKind,
        m.toKind,
        m.thread,
        m.text,
        JSON.stringify(m.pins),
        m.senderSessionId
      ).lastInsertRowid
  );
}

// Settles a held message that never got an ask, so it's neither kept nor sent.
export function discardHeld(id: number): void {
  db.prepare(`DELETE FROM lead_held_mail WHERE id = ? AND state = 'held'`).run(
    id
  );
}

// The open ask holding a thread, if any.
export function openHoldAsk(
  workspaceId: string,
  threadSubject: string
): AskRow | null {
  const row = db
    .prepare(
      `SELECT subject FROM orchestrator_asks
       WHERE workspace_id = ? AND status = 'open' AND substr(subject, 1, ?) = ?
       ORDER BY id LIMIT 1`
    )
    .get(workspaceId, threadSubject.length + 1, `${threadSubject}:`) as
    { subject: string } | undefined;
  return row ? openBySubject(workspaceId, row.subject) : null;
}

const heldIdOf = (subject: string): number | null => {
  if (!subject.startsWith(PREFIX)) return null;
  const n = Number(subject.slice(subject.lastIndexOf(":") + 1));
  return Number.isInteger(n) && n > 0 ? n : null;
};

// Called when an ask is answered. Only a lead-thread ask has a held message.
export async function settleHeldAsk(
  ask: AskRow,
  action: "approve" | "decline" | "reply"
): Promise<void> {
  const id = heldIdOf(ask.subject);
  if (id === null) return;
  const state = action === "approve" ? "delivered" : "dropped";
  // Claimed before anything is sent, so a second answer finds nothing.
  const claimed = db
    .prepare(
      `UPDATE lead_held_mail SET state = ? WHERE id = ? AND state = 'held'
       RETURNING *`
    )
    .get(state, id) as
    | {
        workspace_id: string;
        from_kind: string;
        to_kind: string;
        thread: string;
        text: string;
        pins: string | null;
        sender_session_id: string;
      }
    | undefined;
  if (!claimed) return;
  const w = claimed.workspace_id;
  if (action === "approve") {
    await sendMail(
      w,
      claimed.sender_session_id,
      claimed.from_kind,
      claimed.to_kind,
      claimed.thread,
      claimed.text,
      JSON.parse(claimed.pins ?? "[]") as number[]
    );
    return;
  }
  await tellLead(
    w,
    claimed.from_kind,
    `Your held message to the ${claimed.to_kind} lead on "${claimed.thread}" wasn't delivered: it was declined.`
  );
}
