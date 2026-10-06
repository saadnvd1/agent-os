/**
 * The orchestrator's events, kept in `orchestrator_events` by key. A key
 * present means the orchestrator has been told, or will be; so a restart
 * diffs against the same set and resends nothing.
 *
 * Every orchestrator message is a paid turn, so flapping is damped:
 * - a condition must hold on two diffs in a row before it's sent (hits);
 * - one that clears before it's sent is dropped;
 * - one that clears after it's sent is remembered (cleared_at), and coming
 *   back within REFIRE_MS doesn't send it again;
 * - a session or stack item seen for the first time has its current state
 *   taken as known, not sent as news (a `seen:` marker per subject).
 */

import { db } from "../db";
import type { Condition } from "./conditions";

export interface EventRow {
  id: number;
  workspace_id: string;
  key: string;
  subject: string | null;
  line: string;
  sticky: number;
  low: number;
  hits: number;
  created_at: string;
  delivered_at: string | null;
  cleared_at: string | null;
}

export const REFIRE_MS = 15 * 60 * 1000;
const ARMED = 2;
const SEEN = "seen:";

const iso = (ms: number) => new Date(ms).toISOString();

// Diffs the workspace's conditions against what's stored. `subjects` are
// every session, stack item and stack in the workspace now, conditions or
// not. Returns the lines that became ready to send on this diff.
export function recordConditions(
  workspaceId: string,
  conditions: Condition[],
  subjects: string[],
  now = Date.now()
): string[] {
  const rows = db
    .prepare(`SELECT * FROM orchestrator_events WHERE workspace_id = ?`)
    .all(workspaceId) as EventRow[];
  const byKey = new Map(rows.map((r) => [r.key, r]));
  const fresh = new Set(subjects.filter((s) => !byKey.has(`${SEEN}${s}`)));
  const current = new Map(conditions.map((c) => [c.key, c]));
  const insert = db.prepare(
    `INSERT OR IGNORE INTO orchestrator_events
       (workspace_id, key, subject, line, sticky, low, hits, created_at, delivered_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const update = db.prepare(
    `UPDATE orchestrator_events
     SET line = ?, hits = ?, delivered_at = ?, cleared_at = ?, created_at = ?
     WHERE id = ?`
  );
  const remove = db.prepare(`DELETE FROM orchestrator_events WHERE id = ?`);
  const ready: string[] = [];

  db.transaction(() => {
    for (const s of fresh)
      insert.run(
        workspaceId,
        `${SEEN}${s}`,
        s,
        SEEN,
        1,
        0,
        ARMED,
        iso(now),
        iso(now)
      );

    for (const c of current.values()) {
      const row = byKey.get(c.key);
      if (!row) {
        // A subject's first look is known state; anything else starts unarmed.
        const known = fresh.has(c.subject);
        insert.run(
          workspaceId,
          c.key,
          c.subject,
          c.line,
          c.sticky ? 1 : 0,
          c.low ? 1 : 0,
          known ? ARMED : 1,
          iso(now),
          known ? iso(now) : null
        );
      } else if (row.cleared_at) {
        // It cleared after being sent and is back.
        const sentAt = row.delivered_at ? Date.parse(row.delivered_at) : 0;
        if (now - sentAt < REFIRE_MS)
          update.run(
            row.line,
            row.hits,
            row.delivered_at,
            null,
            row.created_at,
            row.id
          );
        else update.run(c.line, 1, null, null, iso(now), row.id);
      } else if (!row.delivered_at && row.hits < ARMED) {
        update.run(c.line, ARMED, null, null, row.created_at, row.id);
        ready.push(c.line);
      }
    }

    for (const r of rows) {
      if (r.key.startsWith(SEEN) || current.has(r.key)) continue;
      if (!r.delivered_at) remove.run(r.id);
      else if (!r.sticky && !r.cleared_at)
        update.run(
          r.line,
          r.hits,
          r.delivered_at,
          iso(now),
          r.created_at,
          r.id
        );
    }

    // Anything about sessions and stack items that are gone, and passing
    // events that cleared a day ago.
    db.prepare(
      `DELETE FROM orchestrator_events WHERE workspace_id = ? AND (
         (subject IS NOT NULL
           AND subject NOT IN (SELECT id FROM sessions)
           AND subject NOT IN (SELECT id FROM stack_items)
           AND subject NOT IN (SELECT id FROM stacks))
         OR (cleared_at IS NOT NULL AND cleared_at < ?))`
    ).run(workspaceId, iso(now - 24 * 60 * 60 * 1000));
  })();
  return ready;
}

// Ready to send: held on two diffs, not sent yet.
export function pendingEvents(workspaceId: string): EventRow[] {
  return db
    .prepare(
      `SELECT * FROM orchestrator_events
       WHERE workspace_id = ? AND delivered_at IS NULL AND hits >= ?
       ORDER BY id`
    )
    .all(workspaceId, ARMED) as EventRow[];
}

export function markDelivered(
  ids: number[],
  at: number | null = Date.now()
): void {
  const stmt = db.prepare(
    `UPDATE orchestrator_events SET delivered_at = ? WHERE id = ?`
  );
  db.transaction(() => {
    for (const id of ids) stmt.run(at === null ? null : iso(at), id);
  })();
}

// Each delivered event, by subject: for the per-subject cap and the
// batching window.
export function logDeliveries(
  workspaceId: string,
  subjects: (string | null)[],
  at: number
): number[] {
  const stmt = db.prepare(
    `INSERT INTO orchestrator_event_log (workspace_id, subject, delivered_at) VALUES (?, ?, ?)`
  );
  return db.transaction(() =>
    subjects.map((s) =>
      Number(stmt.run(workspaceId, s, iso(at)).lastInsertRowid)
    )
  )();
}

export function unlogDeliveries(ids: number[]): void {
  const stmt = db.prepare(`DELETE FROM orchestrator_event_log WHERE id = ?`);
  db.transaction(() => ids.forEach((id) => stmt.run(id)))();
}

export function lastDeliveredAt(workspaceId: string): number {
  const row = db
    .prepare(
      `SELECT MAX(delivered_at) AS at FROM orchestrator_event_log WHERE workspace_id = ?`
    )
    .get(workspaceId) as { at: string | null };
  return row.at ? Date.parse(row.at) : 0;
}

export function deliveriesSince(
  workspaceId: string,
  subject: string,
  since: number
): number {
  return (
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM orchestrator_event_log
         WHERE workspace_id = ? AND subject = ? AND delivered_at >= ?`
      )
      .get(workspaceId, subject, iso(since)) as { n: number }
  ).n;
}
