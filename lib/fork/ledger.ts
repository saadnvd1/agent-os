/**
 * The children ledger: what a session has forked, kept in the database so
 * it survives compaction, restarts and fresh conversations. A child settles
 * once, by a conditional UPDATE; whichever caller's update changed a row
 * acts on it.
 */

import { randomUUID } from "crypto";
import { db } from "../db";
import { FORK_LIMITS } from "./options";
import type { ChildOutcome, ChildRow, GroupRow, ResultKind } from "./types";

const OPEN = `state != 'settled'`;

export const newGroupId = () => `g${randomUUID().slice(0, 6)}`;

export interface NewChild {
  childId: string;
  label: string;
  instruction: string;
  worktree: boolean;
}

export function groupByRequest(requestId: string): GroupRow | undefined {
  return db
    .prepare(`SELECT * FROM fork_groups WHERE request_id = ?`)
    .get(requestId) as GroupRow | undefined;
}

export const getGroup = (id: string): GroupRow | undefined =>
  db.prepare(`SELECT * FROM fork_groups WHERE id = ?`).get(id) as
    GroupRow | undefined;

// The group and its children in one transaction, so a crash leaves both or
// neither. A repeat of the same request id is the caller's check, made first
// (the column is UNIQUE, so a race fails here rather than doubling).
export function insertGroup(input: {
  id: string;
  parentId: string;
  requestId: string;
  startedBy: "agent" | "user";
  context: "fork" | "brief";
  delivery: "wake" | "next";
  forkItemId?: string | null;
  children: NewChild[];
  now?: number;
}): void {
  const now = input.now ?? Date.now();
  db.transaction(() => {
    db.prepare(
      `INSERT INTO fork_groups (id, parent_session_id, request_id, started_by, context, delivery, fork_item_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      input.id,
      input.parentId,
      input.requestId,
      input.startedBy,
      input.context,
      input.delivery,
      input.forkItemId ?? null,
      now
    );
    const add = db.prepare(
      `INSERT INTO session_children (child_session_id, parent_session_id, group_id, position, label, instruction, worktree, state, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', ?)`
    );
    input.children.forEach((c, i) =>
      add.run(
        c.childId,
        input.parentId,
        input.id,
        i + 1,
        c.label,
        c.instruction,
        c.worktree ? 1 : 0,
        now
      )
    );
  })();
}

export const getChild = (id: string): ChildRow | undefined =>
  db
    .prepare(`SELECT * FROM session_children WHERE child_session_id = ?`)
    .get(id) as ChildRow | undefined;

export const isChild = (sessionId: string): boolean => !!getChild(sessionId);

// A parent's children, oldest first: the order the numbers in `aos
// children` follow, across groups.
export function childrenOf(parentId: string): ChildRow[] {
  return db
    .prepare(
      `SELECT * FROM session_children WHERE parent_session_id = ?
       ORDER BY created_at, group_id, position`
    )
    .all(parentId) as ChildRow[];
}

export const numberOf = (parentId: string, childId: string): number =>
  childrenOf(parentId).findIndex((c) => c.child_session_id === childId) + 1;

export const openChildren = (parentId: string): ChildRow[] =>
  db
    .prepare(
      `SELECT * FROM session_children WHERE parent_session_id = ? AND ${OPEN}
       ORDER BY created_at, group_id, position`
    )
    .all(parentId) as ChildRow[];

export const groupChildren = (groupId: string): ChildRow[] =>
  db
    .prepare(
      `SELECT * FROM session_children WHERE group_id = ? ORDER BY position`
    )
    .all(groupId) as ChildRow[];

// A child named the way an agent or a person would: its number in `aos
// children`, its label, or its session id (or a prefix of it).
export function findChild(parentId: string, ref: string): ChildRow {
  const all = childrenOf(parentId);
  const text = ref.trim();
  if (/^\d+$/.test(text)) {
    const c = all[Number(text) - 1];
    if (c) return c;
    throw new Error(`No child ${text}: you have ${all.length}`);
  }
  const byId = all.filter((c) => c.child_session_id.startsWith(text));
  if (byId.length === 1) return byId[0];
  const byLabel = all.filter(
    (c) => c.label.toLowerCase() === text.toLowerCase()
  );
  if (byLabel.length === 1) return byLabel[0];
  if (byLabel.length > 1)
    throw new Error(
      `${byLabel.length} children are named ${text}: use their numbers`
    );
  throw new Error(`No child "${text}" of this session`);
}

export function setState(
  childId: string,
  state: ChildRow["state"],
  hold: string | null = null,
  now = Date.now()
): void {
  if (state === "settled") throw new Error("Settle through settleChild");
  db.prepare(
    `UPDATE session_children SET state = ?, hold = ?,
       started_at = CASE WHEN ? = 'running' AND started_at IS NULL THEN ? ELSE started_at END
     WHERE child_session_id = ? AND state != 'settled'`
  ).run(state, hold, state, now, childId);
}

export const markFellBack = (childId: string): void => {
  db.prepare(
    `UPDATE session_children SET fell_back = 1 WHERE child_session_id = ?`
  ).run(childId);
};

export const setCut = (childId: string, cut: string | null): void => {
  db.prepare(
    `UPDATE session_children SET cut_message_id = ? WHERE child_session_id = ?`
  ).run(cut, childId);
};

// First line, cut: what the parent's agent sees.
export function summaryOf(text: string): string {
  const line =
    text
      .trim()
      .split("\n")
      .find((l) => l.trim()) ?? "";
  const one = line.replace(/\s+/g, " ").trim();
  const max = FORK_LIMITS.summaryChars;
  return one.length <= max ? one : `${one.slice(0, max - 1)}…`;
}

export const capResult = (text: string): string =>
  text.length <= FORK_LIMITS.resultChars
    ? text
    : `${text.slice(0, FORK_LIMITS.resultChars)}\n… (cut)`;

// True for the one caller that settled it.
export function settleChild(
  childId: string,
  s: {
    outcome: ChildOutcome;
    summary: string;
    result?: string | null;
    kind: ResultKind;
    tokens?: { in: number; out: number; cacheRead: number } | null;
    now?: number;
  }
): boolean {
  const now = s.now ?? Date.now();
  const changed =
    db
      .prepare(
        `UPDATE session_children SET state = 'settled', hold = NULL, idle_since = NULL,
           outcome = ?, summary = ?, result = ?, result_kind = ?, settled_at = ?,
           started_at = COALESCE(started_at, ?),
           tokens_in = ?, tokens_out = ?, cache_read = ?
         WHERE child_session_id = ? AND state != 'settled'`
      )
      .run(
        s.outcome,
        s.summary,
        s.result ? capResult(s.result) : null,
        s.kind,
        now,
        now,
        s.tokens?.in ?? null,
        s.tokens?.out ?? null,
        s.tokens?.cacheRead ?? null,
        childId
      ).changes === 1;
  if (changed)
    db.prepare(
      `UPDATE fork_groups SET last_settled_at = ? WHERE id =
         (SELECT group_id FROM session_children WHERE child_session_id = ?)`
    ).run(now, childId);
  return changed;
}

// A return after settling: the new text stands, shown as updated, and is
// sent again only if the first hadn't been (a delivered one stays delivered).
export function updateResult(
  childId: string,
  summary: string,
  result: string | null,
  outcome: ChildOutcome
): void {
  db.prepare(
    `UPDATE session_children SET summary = ?, result = ?, outcome = ?, result_kind = 'explicit'
     WHERE child_session_id = ? AND state = 'settled' AND outcome != 'cancelled'`
  ).run(summary, result ? capResult(result) : null, outcome, childId);
}

export const markIdle = (childId: string, since: number | null): void => {
  db.prepare(
    `UPDATE session_children SET idle_since = ? WHERE child_session_id = ?`
  ).run(since, childId);
};

export const bumpHeavy = (childId: string): void => {
  db.prepare(
    `UPDATE session_children SET heavy_runs = heavy_runs + 1 WHERE child_session_id = ?`
  ).run(childId);
};

export const markUsed = (
  childId: string,
  how: "opened" | "mentioned"
): void => {
  db.prepare(
    `UPDATE session_children SET used = ?
     WHERE child_session_id = ? AND (used IS NULL OR (used = 'mentioned' AND ? = 'opened'))`
  ).run(how, childId, how);
};

// Settled and not yet handed to the parent's agent, oldest first.
export const undelivered = (parentId: string): ChildRow[] =>
  db
    .prepare(
      `SELECT * FROM session_children
       WHERE parent_session_id = ? AND settled_at IS NOT NULL AND delivered_at IS NULL
       ORDER BY settled_at, position`
    )
    .all(parentId) as ChildRow[];

export const parentsWithUndelivered = (): string[] =>
  (
    db
      .prepare(
        `SELECT DISTINCT parent_session_id AS id FROM session_children
         WHERE settled_at IS NOT NULL AND delivered_at IS NULL`
      )
      .all() as { id: string }[]
  ).map((r) => r.id);

// Marks these rows as one delivery; only rows nobody claimed change. The
// rows that now carry the id are returned, so a crash between the claim and
// the send just sends the same id again.
export function claimDelivery(ids: string[], deliveryId: string): ChildRow[] {
  const claim = db.prepare(
    `UPDATE session_children SET delivery_id = ?
     WHERE child_session_id = ? AND delivery_id IS NULL AND delivered_at IS NULL`
  );
  db.transaction(() => ids.forEach((id) => claim.run(deliveryId, id)))();
  return db
    .prepare(
      `SELECT * FROM session_children WHERE delivery_id = ? ORDER BY settled_at, position`
    )
    .all(deliveryId) as ChildRow[];
}

export const markDelivered = (deliveryId: string, now = Date.now()): number =>
  db
    .prepare(
      `UPDATE session_children SET delivered_at = ? WHERE delivery_id = ? AND delivered_at IS NULL`
    )
    .run(now, deliveryId).changes;

// A result already in a wait's wake message, so it isn't sent again.
export const markDeliveredIds = (ids: string[], now = Date.now()): void => {
  const mark = db.prepare(
    `UPDATE session_children SET delivered_at = ? WHERE child_session_id = ? AND delivered_at IS NULL`
  );
  db.transaction(() => ids.forEach((id) => mark.run(now, id)))();
};

export const unsettledWithDelivery = (parentId: string): string | null =>
  (
    db
      .prepare(
        `SELECT delivery_id AS d FROM session_children
         WHERE parent_session_id = ? AND delivery_id IS NOT NULL AND delivered_at IS NULL LIMIT 1`
      )
      .get(parentId) as { d: string } | undefined
  )?.d ?? null;

export const allChildren = (): ChildRow[] =>
  db.prepare(`SELECT * FROM session_children`).all() as ChildRow[];
