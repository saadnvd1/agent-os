import { db } from "@/lib/db";
import type { LeadKind, LeadMemo } from "./types";

// About 1.5k tokens: what a lead carries across a fresh start, with its
// pinned direction.
export const MEMO_CAP = 6000;

interface Row {
  id: number;
  workspace_id: string;
  lead_kind: string;
  text: string;
  created_at: string;
}

const view = (r: Row): LeadMemo => ({
  id: r.id,
  workspaceId: r.workspace_id,
  leadKind: r.lead_kind,
  text: r.text,
  createdAt: r.created_at,
});

// Every version is kept; the newest is the memo.
export function writeMemo(
  workspaceId: string,
  leadKind: LeadKind,
  text: string
): LeadMemo {
  const body = text.trim().slice(0, MEMO_CAP);
  if (!body) throw new Error("The memo is empty");
  const { lastInsertRowid } = db
    .prepare(
      `INSERT INTO lead_memos (workspace_id, lead_kind, text) VALUES (?, ?, ?)`
    )
    .run(workspaceId, leadKind, body);
  return view(
    db
      .prepare(`SELECT * FROM lead_memos WHERE id = ?`)
      .get(Number(lastInsertRowid)) as Row
  );
}

export function latestMemo(
  workspaceId: string,
  leadKind: LeadKind
): LeadMemo | null {
  const r = db
    .prepare(
      `SELECT * FROM lead_memos WHERE workspace_id = ? AND lead_kind = ?
       ORDER BY id DESC LIMIT 1`
    )
    .get(workspaceId, leadKind) as Row | undefined;
  return r ? view(r) : null;
}

export function memoHistory(
  workspaceId: string,
  leadKind: LeadKind,
  limit = 20
): LeadMemo[] {
  return (
    db
      .prepare(
        `SELECT * FROM lead_memos WHERE workspace_id = ? AND lead_kind = ?
         ORDER BY id DESC LIMIT ?`
      )
      .all(workspaceId, leadKind, limit) as Row[]
  ).map(view);
}
