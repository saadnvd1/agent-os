/**
 * The push outbox (SQLite, so a restart keeps what's waiting): one row per
 * event and device. A row is marked `sending` before the relay is called; a
 * restart puts it back to `pending`, and the repeat carries the same collapse
 * id, so the phone replaces the alert rather than stacking a second.
 */

import { db } from "../../db";
import type { PushCategory, PushLevel } from "../push-types";
import { HOUR_MS } from "./policy";

export type PushState =
  | "pending"
  | "sending"
  | "sent"
  | "failed"
  | "gone"
  | "capped"
  | "superseded"
  | "folded"
  | "digested";

export interface OutboxRow {
  id: number;
  event_key: string;
  device_id: string;
  category: PushCategory;
  level: PushLevel;
  payload: string;
  collapse_id: string | null;
  state: PushState;
  attempts: number;
  next_attempt_at: number;
  created_at: number;
  sent_at: number | null;
  error: string | null;
  fallback_source: string | null;
  fallback_text: string | null;
}

/** An event older than this isn't worth buzzing about any more. */
export const MAX_AGE_MS = HOUR_MS;
const KEEP_MS = 7 * 24 * HOUR_MS;

export const isTestKey = (eventKey: string) => eventKey.startsWith("test:");

export interface NewRow {
  eventKey: string;
  deviceId: string;
  category: PushCategory;
  level: PushLevel;
  payload: unknown;
  collapseId: string | null;
  state?: "pending" | "capped" | "folded";
  now: number;
  fallback?: { source: string; text: string } | null;
}

/** False when this event was already queued for the device. */
export function enqueue(r: NewRow): boolean {
  const state = r.state ?? "pending";
  return db.transaction(() => {
    const { changes } = db
      .prepare(
        `INSERT OR IGNORE INTO push_outbox
           (event_key, device_id, category, level, payload, collapse_id, state,
            next_attempt_at, created_at, fallback_source, fallback_text)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        r.eventKey,
        r.deviceId,
        r.category,
        r.level,
        JSON.stringify(r.payload),
        r.collapseId,
        state,
        r.now,
        r.now,
        r.fallback?.source ?? null,
        r.fallback?.text ?? null
      );
    if (changes && state === "pending" && r.collapseId)
      db.prepare(
        `UPDATE push_outbox SET state = 'superseded'
         WHERE device_id = ? AND collapse_id = ? AND state = 'pending' AND event_key != ?`
      ).run(r.deviceId, r.collapseId, r.eventKey);
    return changes > 0;
  })();
}

/** Alerting pushes made for a device in the last hour (the cap's count). */
export function alertingSince(deviceId: string, now: number): number {
  return (
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM push_outbox
         WHERE device_id = ? AND created_at > ? AND level != 'passive'
           AND category != 'asks' AND event_key NOT LIKE 'test:%'
           AND state IN ('pending', 'sending', 'sent')`
      )
      .get(deviceId, now - HOUR_MS) as { n: number }
  ).n;
}

/** Folded into the next Away digest: how many were waiting, now counted. */
export function takeFolded(now: number): number {
  return db
    .prepare(
      `UPDATE push_outbox SET state = 'digested', sent_at = ? WHERE state = 'folded'`
    )
    .run(now).changes;
}

/** Pending rows past their age limit fail; returns their event keys. */
export function expire(now: number): string[] {
  const rows = db
    .prepare(
      `SELECT DISTINCT event_key FROM push_outbox WHERE state = 'pending' AND created_at < ?`
    )
    .all(now - MAX_AGE_MS) as { event_key: string }[];
  if (rows.length)
    db.prepare(
      `UPDATE push_outbox SET state = 'failed', error = 'too old to send'
       WHERE state = 'pending' AND created_at < ?`
    ).run(now - MAX_AGE_MS);
  return rows.map((r) => r.event_key);
}

/** Due rows, marked sending with the attempt counted. */
export function claimDue(now: number, limit = 50): OutboxRow[] {
  return db.transaction(() => {
    const rows = db
      .prepare(
        `SELECT * FROM push_outbox WHERE state = 'pending' AND next_attempt_at <= ?
         ORDER BY id LIMIT ?`
      )
      .all(now, limit) as OutboxRow[];
    const mark = db.prepare(
      `UPDATE push_outbox SET state = 'sending', attempts = attempts + 1 WHERE id = ?`
    );
    for (const r of rows) {
      mark.run(r.id);
      r.attempts += 1;
      r.state = "sending";
    }
    return rows;
  })();
}

export function markSent(id: number, now: number): void {
  db.prepare(
    `UPDATE push_outbox SET state = 'sent', sent_at = ?, error = NULL WHERE id = ?`
  ).run(now, id);
}

export function markFailed(id: number, error: string, gone = false): void {
  db.prepare(`UPDATE push_outbox SET state = ?, error = ? WHERE id = ?`).run(
    gone ? "gone" : "failed",
    error.slice(0, 200),
    id
  );
}

export function markRetry(id: number, at: number, error: string): void {
  db.prepare(
    `UPDATE push_outbox SET state = 'pending', next_attempt_at = ?, error = ? WHERE id = ?`
  ).run(at, error.slice(0, 200), id);
}

/** Everything waiting fails at once, so a dead relay is asked once, not per row. */
export function failPending(error: string): string[] {
  const keys = db
    .prepare(
      `SELECT DISTINCT event_key FROM push_outbox WHERE state = 'pending'`
    )
    .all() as { event_key: string }[];
  db.prepare(
    `UPDATE push_outbox SET state = 'failed', error = ? WHERE state = 'pending'`
  ).run(error.slice(0, 200));
  return keys.map((k) => k.event_key);
}

/** Every row of the event has ended and none reached a phone. */
export function claimFallback(
  eventKey: string
): { source: string; text: string } | null {
  return db.transaction(() => {
    const rows = db
      .prepare(
        `SELECT state, fallback_source, fallback_text FROM push_outbox WHERE event_key = ?`
      )
      .all(eventKey) as Pick<
      OutboxRow,
      "state" | "fallback_source" | "fallback_text"
    >[];
    if (
      !rows.length ||
      !rows.every((r) => r.state === "failed" || r.state === "gone")
    )
      return null;
    const row = rows.find((r) => r.fallback_text);
    if (!row?.fallback_text) return null;
    db.prepare(
      `UPDATE push_outbox SET fallback_text = NULL WHERE event_key = ?`
    ).run(eventKey);
    return { source: row.fallback_source ?? "push", text: row.fallback_text };
  })();
}

export function nextDueAt(): number | null {
  const r = db
    .prepare(
      `SELECT MIN(next_attempt_at) AS at FROM push_outbox WHERE state = 'pending'`
    )
    .get() as { at: number | null };
  return r.at;
}

export function rowsFor(eventKey: string): OutboxRow[] {
  return db
    .prepare(`SELECT * FROM push_outbox WHERE event_key = ? ORDER BY id`)
    .all(eventKey) as OutboxRow[];
}

/** After a restart: what was mid-send goes again; old history is dropped. */
export function resume(now: number): void {
  db.prepare(
    `UPDATE push_outbox SET state = 'pending', next_attempt_at = ? WHERE state = 'sending'`
  ).run(now);
  db.prepare(
    `DELETE FROM push_outbox WHERE state NOT IN ('pending', 'sending', 'folded')
       AND created_at < ?`
  ).run(now - KEEP_MS);
  db.prepare(
    `DELETE FROM push_outbox WHERE state = 'folded' AND created_at < ?`
  ).run(now - 24 * HOUR_MS);
}
