/**
 * Anomalies: one open row per check and subject. A trip that is already open
 * only bumps it; one that comes back within REOPEN_MS of clearing reopens the
 * same row instead of starting a second one (and so wakes nobody again);
 * only a rise from warn to high is news while open.
 */

import { db } from "../db";
import {
  AREA_OF,
  MIN,
  type AnomalyRow,
  type CheckId,
  type Severity,
  type Trip,
  type Verdict,
} from "./types";

// Absent this long before it clears: a blip in a check isn't an end.
export const CLEAR_AFTER_MS = 5 * MIN;
export const REOPEN_MS = 30 * MIN;
export const MUTE_MS = 24 * 60 * MIN;

export interface RecordResult {
  opened: AnomalyRow[];
  raised: AnomalyRow[];
  closed: AnomalyRow[];
}

const rowOf = (id: number) =>
  db.prepare(`SELECT * FROM health_anomalies WHERE id = ?`).get(id) as
    | AnomalyRow
    | undefined;

export function anomaly(id: number): AnomalyRow | null {
  return rowOf(id) ?? null;
}

function record(trip: Trip, now: number, out: RecordResult): void {
  const muted = db
    .prepare(
      `SELECT 1 FROM health_anomalies WHERE check_id = ? AND subject = ?
       AND muted_until > ? LIMIT 1`
    )
    .get(trip.check, trip.subject, now);
  if (muted) return;

  const open = db
    .prepare(
      `SELECT * FROM health_anomalies WHERE check_id = ? AND subject = ?
       AND closed_at IS NULL`
    )
    .get(trip.check, trip.subject) as AnomalyRow | undefined;
  const detail = JSON.stringify(trip.detail);
  if (open) {
    const rises = open.severity === "warn" && trip.severity === "high";
    db.prepare(
      `UPDATE health_anomalies SET last_seen_at = ?, hits = hits + 1, line = ?,
         detail = ?, severity = ? WHERE id = ?`
    ).run(now, trip.line, detail, rises ? "high" : open.severity, open.id);
    if (rises) out.raised.push(rowOf(open.id)!);
    return;
  }

  const recent = db
    .prepare(
      `SELECT * FROM health_anomalies WHERE check_id = ? AND subject = ?
       AND close_reason = 'cleared' AND closed_at >= ?
       ORDER BY closed_at DESC LIMIT 1`
    )
    .get(trip.check, trip.subject, now - REOPEN_MS) as AnomalyRow | undefined;
  if (recent) {
    db.prepare(
      `UPDATE health_anomalies SET closed_at = NULL, close_reason = NULL,
         last_seen_at = ?, hits = hits + 1, line = ?, detail = ?,
         severity = CASE WHEN severity = 'high' THEN 'high' ELSE ? END
       WHERE id = ?`
    ).run(now, trip.line, detail, trip.severity, recent.id);
    const after = rowOf(recent.id)!;
    if (after.severity === "high" && recent.severity === "warn")
      out.raised.push(after);
    return;
  }

  const info = db
    .prepare(
      `INSERT INTO health_anomalies
         (check_id, subject, area, severity, line, detail, workspace_id,
          opened_at, last_seen_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      trip.check,
      trip.subject,
      AREA_OF[trip.check],
      trip.severity,
      trip.line,
      detail,
      trip.workspaceId,
      now,
      now
    );
  out.opened.push(rowOf(Number(info.lastInsertRowid))!);
}

// Records what the checks found. `evaluated` is the checks that ran, so an
// anomaly of a check that didn't run (piece-dup, raised elsewhere) isn't
// cleared for being absent.
export function recordTrips(
  trips: Trip[],
  evaluated: readonly CheckId[],
  now: number
): RecordResult {
  const out: RecordResult = { opened: [], raised: [], closed: [] };
  db.transaction(() => {
    for (const t of trips) record(t, now, out);
    const open = db
      .prepare(`SELECT * FROM health_anomalies WHERE closed_at IS NULL`)
      .all() as AnomalyRow[];
    for (const row of open) {
      if (!evaluated.includes(row.check_id)) continue;
      if (now - row.last_seen_at < CLEAR_AFTER_MS) continue;
      if (row.last_seen_at === now) continue;
      close(row.id, "cleared", now);
      out.closed.push(rowOf(row.id)!);
    }
  })();
  return out;
}

export function close(id: number, reason: string, now: number): void {
  db.prepare(
    `UPDATE health_anomalies SET closed_at = ?, close_reason = ?
     WHERE id = ? AND closed_at IS NULL`
  ).run(now, reason, id);
}

// A person's dismissal: closes it and mutes that subject for a day.
export function dismiss(id: number, now = Date.now()): boolean {
  const row = rowOf(id);
  if (!row) return false;
  db.prepare(
    `UPDATE health_anomalies SET closed_at = COALESCE(closed_at, ?),
       close_reason = COALESCE(close_reason, 'dismissed'), muted_until = ?
     WHERE id = ?`
  ).run(now, now + MUTE_MS, id);
  return true;
}

export const openAnomalies = () =>
  db
    .prepare(
      `SELECT * FROM health_anomalies WHERE closed_at IS NULL
       ORDER BY CASE severity WHEN 'high' THEN 0 ELSE 1 END, opened_at`
    )
    .all() as AnomalyRow[];

export const closedSince = (since: number, limit = 200) =>
  db
    .prepare(
      `SELECT * FROM health_anomalies WHERE closed_at IS NOT NULL
       AND closed_at >= ? ORDER BY closed_at DESC LIMIT ?`
    )
    .all(since, limit) as AnomalyRow[];

export const allSince = (since: number) =>
  db
    .prepare(`SELECT * FROM health_anomalies WHERE opened_at >= ?`)
    .all(since) as AnomalyRow[];

// Whether a watcher should look: never judged, or it got worse since.
export function needsWake(row: AnomalyRow): boolean {
  if (row.closed_at !== null) return false;
  if (row.woken_severity === null) return true;
  return row.woken_severity === "warn" && row.severity === "high";
}

export function markWoken(id: number, severity: Severity, now: number): void {
  db.prepare(
    `UPDATE health_anomalies SET woken_severity = ?, woken_at = ? WHERE id = ?`
  ).run(severity, now, id);
}

export function saveVerdict(
  id: number,
  verdict: Verdict,
  tokens: { input: number; output: number } | null
): void {
  db.prepare(
    `UPDATE health_anomalies SET verdict = ?,
       tokens_in = COALESCE(tokens_in, 0) + ?,
       tokens_out = COALESCE(tokens_out, 0) + ? WHERE id = ?`
  ).run(JSON.stringify(verdict), tokens?.input ?? 0, tokens?.output ?? 0, id);
}

export const markDelivered = (id: number, now: number) =>
  db
    .prepare(`UPDATE health_anomalies SET delivered_at = ? WHERE id = ?`)
    .run(now, id);

export const markPhoned = (id: number, now: number) =>
  db
    .prepare(`UPDATE health_anomalies SET phoned_at = ? WHERE id = ?`)
    .run(now, id);

export const verdictOf = (row: Pick<AnomalyRow, "verdict">): Verdict | null => {
  try {
    return row.verdict ? (JSON.parse(row.verdict) as Verdict) : null;
  } catch {
    return null;
  }
};
