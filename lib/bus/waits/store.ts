/**
 * Waits: session A waiting on session B, kept in `bus_waits`. A change of
 * state is claimed with a conditional UPDATE and acted on only by the caller
 * whose update changed a row, so overlapping sweeps and restarts never
 * wake anyone twice.
 */

import { db, type Session } from "../../db";
import { isHeldRemote } from "../../tasks/contract/held-calls";
import { notifySessionsChanged } from "../../status/hub";

export type WaitKind = "reply" | "idle" | "merged";
export type WaitOutcome =
  "replied" | "idle" | "merged" | "timeout" | "ended" | "cancelled";

export interface WaitRow {
  id: number;
  waiter_id: string;
  target_id: string;
  kind: WaitKind;
  message_id: number | null;
  request: string | null;
  deadline: number;
  created_at: number;
  seen_busy_at: number | null;
  nudged_at: number | null;
  closed_at: number | null;
  outcome: WaitOutcome | null;
  reply_id: number | null;
}

export const MAX_OPEN_WAITS = 10;
export const DEFAULT_TIMEOUT_MS = 30 * 60_000;
export const MIN_TIMEOUT_MS = 60_000;
export const MAX_TIMEOUT_MS = 24 * 60 * 60_000;

// A request shown in a line: one line, cut.
export function excerpt(body: string, max = 100): string {
  const one = body.replace(/\s+/g, " ").trim().replace(/"/g, "'");
  return one.length <= max ? one : `${one.slice(0, max - 1)}…`;
}

export function openWait(w: {
  waiterId: string;
  targetId: string;
  kind: WaitKind;
  messageId?: number | null;
  request?: string | null;
  deadline: number;
  now?: number;
}): number {
  const now = w.now ?? Date.now();
  const open = db
    .prepare(
      `SELECT id FROM bus_waits WHERE waiter_id = ? AND target_id = ? AND kind = ? AND closed_at IS NULL`
    )
    .get(w.waiterId, w.targetId, w.kind) as { id: number } | undefined;
  let id: number;
  if (open) {
    // The same wait again: the newer request and deadline stand.
    db.prepare(
      `UPDATE bus_waits SET message_id = ?, request = ?, deadline = ?, nudged_at = NULL WHERE id = ?`
    ).run(w.messageId ?? null, w.request ?? null, w.deadline, open.id);
    id = open.id;
  } else {
    const count = (
      db
        .prepare(
          `SELECT COUNT(*) AS n FROM bus_waits WHERE waiter_id = ? AND closed_at IS NULL`
        )
        .get(w.waiterId) as { n: number }
    ).n;
    if (count >= MAX_OPEN_WAITS)
      throw new Error(
        `You already have ${MAX_OPEN_WAITS} waits open; wait for one to finish`
      );
    id = Number(
      db
        .prepare(
          `INSERT INTO bus_waits (waiter_id, target_id, kind, message_id, request, deadline, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          w.waiterId,
          w.targetId,
          w.kind,
          w.messageId ?? null,
          w.request ?? null,
          w.deadline,
          now
        ).lastInsertRowid
    );
  }
  notifySessionsChanged();
  return id;
}

// True for the one caller that closed it.
export function claimClose(
  id: number,
  outcome: WaitOutcome,
  replyId: number | null = null,
  now = Date.now()
): boolean {
  const changed =
    db
      .prepare(
        `UPDATE bus_waits SET closed_at = ?, outcome = ?, reply_id = ? WHERE id = ? AND closed_at IS NULL`
      )
      .run(now, outcome, replyId, id).changes === 1;
  if (changed) notifySessionsChanged();
  return changed;
}

export const claimNudge = (id: number, now = Date.now()): boolean =>
  db
    .prepare(
      `UPDATE bus_waits SET nudged_at = ? WHERE id = ? AND closed_at IS NULL AND nudged_at IS NULL`
    )
    .run(now, id).changes === 1;

export function markSeenBusy(id: number, now = Date.now()): void {
  db.prepare(
    `UPDATE bus_waits SET seen_busy_at = ? WHERE id = ? AND seen_busy_at IS NULL`
  ).run(now, id);
}

export const openWaits = (): WaitRow[] =>
  db
    .prepare(`SELECT * FROM bus_waits WHERE closed_at IS NULL ORDER BY id`)
    .all() as WaitRow[];

// A reply from `targetId` to `waiterId` settles these.
export const replyWaitsFor = (waiterId: string, targetId: string): WaitRow[] =>
  db
    .prepare(
      `SELECT * FROM bus_waits WHERE waiter_id = ? AND target_id = ? AND kind = 'reply' AND closed_at IS NULL ORDER BY id`
    )
    .all(waiterId, targetId) as WaitRow[];

export interface WaitBadges {
  on: { id: string; name: string; kind: WaitKind; deadline: number }[];
  by: { id: string; name: string }[];
}

// Who each session waits on, and who waits on it, for the open waits.
export function waitBadges(): Map<string, WaitBadges> {
  const rows = db
    .prepare(
      `SELECT w.waiter_id, w.target_id, w.kind, w.deadline,
              COALESCE(a.name, 'a session') AS waiter_name,
              COALESCE(b.name, 'a session') AS target_name
       FROM bus_waits w
       LEFT JOIN sessions a ON a.id = w.waiter_id
       LEFT JOIN sessions b ON b.id = w.target_id
       WHERE w.closed_at IS NULL ORDER BY w.id`
    )
    .all() as {
    waiter_id: string;
    target_id: string;
    kind: WaitKind;
    deadline: number;
    waiter_name: string;
    target_name: string;
  }[];
  const out = new Map<string, WaitBadges>();
  const get = (id: string) => {
    let b = out.get(id);
    if (!b) out.set(id, (b = { on: [], by: [] }));
    return b;
  };
  for (const r of rows) {
    get(r.waiter_id).on.push({
      id: r.target_id,
      name: r.target_name,
      kind: r.kind,
      deadline: r.deadline,
    });
    get(r.target_id).by.push({ id: r.waiter_id, name: r.waiter_name });
  }
  return out;
}

// "B", "B and C", "B, C +2": for a sidebar chip.
export function namesLine(names: string[]): string {
  const unique = [...new Set(names)];
  if (unique.length <= 2) return unique.join(" and ");
  return `${unique.slice(0, 2).join(", ")} +${unique.length - 2}`;
}

// Why a wait on this session can't be kept, or null.
export function cantWaitOn(to: Session): string | null {
  if (isHeldRemote(to) || (to.peer_mirror && !to.task_prompt))
    return "it runs on a linked machine, which can't tell this one when it answers";
  return null;
}
