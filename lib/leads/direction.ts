import { db } from "@/lib/db";
import type { Session } from "@/lib/db/types";
import { getItem } from "@/lib/chat/store";
import { originOf } from "@/lib/chat/origin";
import { leadKindOf } from "./roles";
import type { DirectionPin, LeadKind, PinProposal } from "./types";

const QUOTE_CAP = 2000;

interface PinRow {
  id: number;
  workspace_id: string;
  lead_kind: string;
  session_id: string;
  chat_item_id: string;
  quote: string;
  set_at: string;
  superseded_by: number | null;
  retired_at: string | null;
}

interface ProposalRow {
  id: number;
  workspace_id: string;
  lead_kind: string;
  session_id: string;
  chat_item_id: string;
  quote: string;
  status: PinProposal["status"];
  created_at: string;
  resolved_at: string | null;
}

const pinView = (r: PinRow): DirectionPin => ({
  id: r.id,
  workspaceId: r.workspace_id,
  leadKind: r.lead_kind,
  sessionId: r.session_id,
  chatItemId: r.chat_item_id,
  quote: r.quote,
  setAt: r.set_at,
  supersededBy: r.superseded_by,
  retiredAt: r.retired_at,
});

const proposalView = (r: ProposalRow): PinProposal => ({
  id: r.id,
  workspaceId: r.workspace_id,
  leadKind: r.lead_kind,
  sessionId: r.session_id,
  chatItemId: r.chat_item_id,
  quote: r.quote,
  status: r.status,
  createdAt: r.created_at,
  resolvedAt: r.resolved_at,
});

// The words a pin may quote: a message the person typed in this chat, read
// from the database. An event, a peer, a schedule or the agent's own text
// is never direction, whatever a lead says about it.
export function authoredQuote(
  sessionId: string,
  chatItemId: string
): string | null {
  const item = getItem(sessionId, chatItemId);
  if (!item || item.kind !== "user" || originOf(item) !== null) return null;
  const text = item.text.trim().slice(0, QUOTE_CAP);
  return text || null;
}

export interface PinTarget {
  workspaceId: string;
  leadKind: LeadKind;
  sessionId: string;
  chatItemId: string;
}

// The quote for a pin in a lead's own chat, or why it can't be one.
function attest(t: PinTarget): { quote: string } | { error: string } {
  const s = db
    .prepare(
      `SELECT role, lead_kind, workspace_id FROM session_rows WHERE id = ?`
    )
    .get(t.sessionId) as
    Pick<Session, "role" | "lead_kind" | "workspace_id"> | undefined;
  if (!s || s.workspace_id !== t.workspaceId || leadKindOf(s) !== t.leadKind)
    return { error: "That chat isn't this lead's" };
  const quote = authoredQuote(t.sessionId, t.chatItemId);
  return quote ? { quote } : { error: "Only your own message can be pinned" };
}

// In force: neither superseded by a newer pin nor taken down.
const IN_FORCE = `superseded_by IS NULL AND retired_at IS NULL`;

export function pinDirection(
  t: PinTarget & { supersedes?: number }
): DirectionPin | { error: string } {
  const a = attest(t);
  if ("error" in a) return a;
  return db.transaction(() => {
    // Pinning a message already in force changes nothing.
    const same = db
      .prepare(
        `SELECT id FROM lead_direction
         WHERE workspace_id = ? AND lead_kind = ? AND chat_item_id = ? AND ${IN_FORCE}`
      )
      .get(t.workspaceId, t.leadKind, t.chatItemId) as
      { id: number } | undefined;
    const id = same
      ? same.id
      : Number(
          db
            .prepare(
              `INSERT INTO lead_direction (workspace_id, lead_kind, session_id, chat_item_id, quote)
               VALUES (?, ?, ?, ?, ?)`
            )
            .run(t.workspaceId, t.leadKind, t.sessionId, t.chatItemId, a.quote)
            .lastInsertRowid
        );
    if (t.supersedes && t.supersedes !== id)
      db.prepare(
        `UPDATE lead_direction SET superseded_by = ?
         WHERE id = ? AND workspace_id = ? AND lead_kind = ? AND ${IN_FORCE}`
      ).run(id, t.supersedes, t.workspaceId, t.leadKind);
    // A lead's suggestion for this message is answered by the pin.
    db.prepare(
      `UPDATE lead_pin_proposals SET status = 'pinned', resolved_at = datetime('now')
       WHERE session_id = ? AND chat_item_id = ? AND status = 'open'`
    ).run(t.sessionId, t.chatItemId);
    return getPin(id)!;
  })();
}

// The person takes a pin down. It stays in the history; false if it wasn't
// in force.
export function retirePin(
  workspaceId: string,
  leadKind: LeadKind,
  id: number
): boolean {
  return (
    db
      .prepare(
        `UPDATE lead_direction SET retired_at = datetime('now')
         WHERE id = ? AND workspace_id = ? AND lead_kind = ? AND ${IN_FORCE}`
      )
      .run(id, workspaceId, leadKind).changes > 0
  );
}

export function getPin(id: number): DirectionPin | null {
  const r = db.prepare(`SELECT * FROM lead_direction WHERE id = ?`).get(id) as
    PinRow | undefined;
  return r ? pinView(r) : null;
}

// The pins in force, newest first.
export function currentDirection(
  workspaceId: string,
  leadKind: LeadKind
): DirectionPin[] {
  return (
    db
      .prepare(
        `SELECT * FROM lead_direction
         WHERE workspace_id = ? AND lead_kind = ? AND ${IN_FORCE}
         ORDER BY id DESC`
      )
      .all(workspaceId, leadKind) as PinRow[]
  ).map(pinView);
}

export function directionHistory(
  workspaceId: string,
  leadKind: LeadKind,
  limit = 100
): DirectionPin[] {
  return (
    db
      .prepare(
        `SELECT * FROM lead_direction WHERE workspace_id = ? AND lead_kind = ?
         ORDER BY id DESC LIMIT ?`
      )
      .all(workspaceId, leadKind, limit) as PinRow[]
  ).map(pinView);
}

// A lead suggests a pin; the quote is still the server's, and nothing is
// direction until the person confirms it.
export function proposePin(t: PinTarget): PinProposal | { error: string } {
  const a = attest(t);
  if ("error" in a) return a;
  db.prepare(
    `INSERT INTO lead_pin_proposals (workspace_id, lead_kind, session_id, chat_item_id, quote)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(session_id, chat_item_id) WHERE status = 'open' DO NOTHING`
  ).run(t.workspaceId, t.leadKind, t.sessionId, t.chatItemId, a.quote);
  const r = db
    .prepare(
      `SELECT * FROM lead_pin_proposals
       WHERE session_id = ? AND chat_item_id = ? AND status = 'open'`
    )
    .get(t.sessionId, t.chatItemId) as ProposalRow;
  return proposalView(r);
}

export function openProposals(
  workspaceId: string,
  leadKind: LeadKind
): PinProposal[] {
  return (
    db
      .prepare(
        `SELECT * FROM lead_pin_proposals
         WHERE workspace_id = ? AND lead_kind = ? AND status = 'open' ORDER BY id`
      )
      .all(workspaceId, leadKind) as ProposalRow[]
  ).map(proposalView);
}

// One tap: pins the confirmed proposals and drops the rest of the open
// ones. The quote is attested again, in case the item changed.
export function resolveProposals(
  workspaceId: string,
  leadKind: LeadKind,
  confirm: readonly number[]
): DirectionPin[] {
  const keep = new Set(confirm);
  return db.transaction(() => {
    const pins: DirectionPin[] = [];
    for (const p of openProposals(workspaceId, leadKind)) {
      const pin = keep.has(p.id) ? pinDirection(p) : null;
      const ok = !!pin && !("error" in pin);
      if (ok) pins.push(pin);
      db.prepare(
        `UPDATE lead_pin_proposals SET status = ?, resolved_at = datetime('now')
         WHERE id = ?`
      ).run(ok ? "pinned" : "dropped", p.id);
    }
    return pins;
  })();
}

// One proposal answered from its chip: pinned (attested again) or dropped.
export function resolveProposal(
  workspaceId: string,
  leadKind: LeadKind,
  id: number,
  pin: boolean
): DirectionPin | { error: string } | null {
  const p = openProposals(workspaceId, leadKind).find((x) => x.id === id);
  if (!p) return { error: "That proposal was already answered" };
  if (pin) return pinDirection(p);
  db.prepare(
    `UPDATE lead_pin_proposals SET status = 'dropped', resolved_at = datetime('now')
     WHERE id = ? AND status = 'open'`
  ).run(id);
  return null;
}
