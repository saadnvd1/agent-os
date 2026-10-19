/**
 * Away mode's state: one row per time Saad stepped away, with who set it,
 * when, and when it runs out (null: until he's back). At most one is open.
 * Times are SQLite's UTC "YYYY-MM-DD HH:MM:SS", like the tables the report
 * reads, so they compare as text.
 */

import { db } from "../db";
import { SWEEP_EVERY_MS } from "./sweep";

export interface AwayRow {
  id: number;
  set_by: string;
  started_at: string;
  expires_at: string | null;
  ended_at: string | null;
  // "saad" when he turned it off, "expired" when its time ran out.
  ended_by: string | null;
  last_sweep_at: string | null;
  asks_notified_at: string | null;
  // The "While you were away" report (./report), JSON, built as it ended.
  report: string | null;
  report_seen_at: string | null;
}

// The longest Away can be set for ahead; "until I'm back" has no end.
export const MAX_AWAY_MS = 7 * 24 * 60 * 60 * 1000;

export const toSql = (ms: number) =>
  new Date(ms).toISOString().replace("T", " ").slice(0, 19);
export const fromSql = (t: string) => Date.parse(`${t.replace(" ", "T")}Z`);

export function activeAway(): AwayRow | null {
  return (
    (db
      .prepare(
        `SELECT * FROM away_periods WHERE ended_at IS NULL ORDER BY id DESC LIMIT 1`
      )
      .get() as AwayRow | undefined) ?? null
  );
}

export function getAway(id: number): AwayRow | null {
  return (
    (db.prepare(`SELECT * FROM away_periods WHERE id = ?`).get(id) as
      AwayRow | undefined) ?? null
  );
}

// The away_actions row marking a workspace Away mode reached this period:
// its orchestrator was active and was told (./run). Keys are unique per
// period, so it names the workspace.
export const toldKey = (workspaceId: string) => `told:${workspaceId}`;

export function reachedWorkspaces(awayId: number): Set<string> {
  return new Set(
    (
      db
        .prepare(
          `SELECT workspace_id FROM away_actions WHERE away_id = ? AND kind = 'told'`
        )
        .all(awayId) as { workspace_id: string }[]
    ).map((r) => r.workspace_id)
  );
}

export const isExpired = (row: AwayRow, now = Date.now()) =>
  !!row.expires_at && fromSql(row.expires_at) <= now;

// Turns Away on, or moves the end of the one already on. Returns the row
// and whether it was newly started.
export function startAway(
  input: { setBy: string; expiresAt: number | null },
  now = Date.now()
): { row: AwayRow; started: boolean } {
  if (input.expiresAt !== null) {
    if (!Number.isFinite(input.expiresAt) || input.expiresAt <= now)
      throw new Error("Away has to end in the future");
    if (input.expiresAt - now > MAX_AWAY_MS)
      throw new Error("Away can be set for at most a week ahead");
  }
  const expires = input.expiresAt === null ? null : toSql(input.expiresAt);
  return db.transaction(() => {
    const open = activeAway();
    if (open) {
      db.prepare(`UPDATE away_periods SET expires_at = ? WHERE id = ?`).run(
        expires,
        open.id
      );
      return { row: getAway(open.id)!, started: false };
    }
    const { lastInsertRowid } = db
      .prepare(
        `INSERT INTO away_periods (set_by, started_at, expires_at) VALUES (?, ?, ?)`
      )
      .run(input.setBy, toSql(now), expires);
    return { row: getAway(Number(lastInsertRowid))!, started: true };
  })();
}

// Ends the open period, once: a second caller (the timer and Saad at the
// same moment) gets null. The end is its expiry when that came first.
export function endAway(
  by: "saad" | "expired",
  now = Date.now()
): AwayRow | null {
  const open = activeAway();
  if (!open) return null;
  const end =
    open.expires_at && fromSql(open.expires_at) < now
      ? open.expires_at
      : toSql(now);
  const changed = db
    .prepare(
      `UPDATE away_periods SET ended_at = ?, ended_by = ? WHERE id = ? AND ended_at IS NULL`
    )
    .run(end, by, open.id).changes;
  return changed ? getAway(open.id) : null;
}

export function saveReport(id: number, report: unknown): void {
  db.prepare(`UPDATE away_periods SET report = ? WHERE id = ?`).run(
    JSON.stringify(report),
    id
  );
}

// The newest ended period's report, until Saad dismisses it. An older one
// he never dismissed is in Audits, not shown again.
export function unseenReport(): AwayRow | null {
  const row = db
    .prepare(
      `SELECT * FROM away_periods WHERE ended_at IS NOT NULL AND report IS NOT NULL
       ORDER BY id DESC LIMIT 1`
    )
    .get() as AwayRow | undefined;
  return row && !row.report_seen_at ? row : null;
}

export function markReportSeen(id: number, now = Date.now()): boolean {
  return (
    db
      .prepare(
        `UPDATE away_periods SET report_seen_at = ? WHERE id = ? AND report IS NOT NULL AND report_seen_at IS NULL`
      )
      .run(toSql(now), id).changes === 1
  );
}

// Claims a sweep: true for the one caller that moved last_sweep_at.
export function claimSweep(
  row: AwayRow,
  everyMs: number,
  now = Date.now()
): boolean {
  if (row.last_sweep_at && now - fromSql(row.last_sweep_at) < everyMs)
    return false;
  return (
    db
      .prepare(
        `UPDATE away_periods SET last_sweep_at = ? WHERE id = ? AND ended_at IS NULL
           AND last_sweep_at IS ?`
      )
      .run(toSql(now), row.id, row.last_sweep_at).changes === 1
  );
}

// "4:30 PM", or "Sat 4:30 PM" when it isn't today, in the server's zone.
export function clockTime(ms: number, now = Date.now()): string {
  const d = new Date(ms);
  const time = d.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
  return d.toDateString() === new Date(now).toDateString()
    ? time
    : `${d.toLocaleDateString("en-US", { weekday: "short" })} ${time}`;
}

export function untilText(row: AwayRow, now = Date.now()): string {
  return row.expires_at
    ? `until ${clockTime(fromSql(row.expires_at), now)}`
    : "until he's back";
}

// While Away is on, an orchestrator's `aos notify` waits for the sweep's
// one batched message rather than buzzing per item. True when held.
export function holdForBatch(
  workspaceId: string,
  sessionId: string,
  text: string,
  now = Date.now()
): boolean {
  const open = activeAway();
  if (!open) return false;
  return (
    db
      .prepare(
        `INSERT OR IGNORE INTO away_actions (away_id, workspace_id, subject, kind, key, detail, created_at)
         VALUES (?, ?, ?, 'notify', ?, ?, ?)`
      )
      .run(
        open.id,
        workspaceId,
        sessionId,
        `notify:${sessionId}:${now}:${text.length}`,
        text,
        toSql(now)
      ).changes === 1
  );
}

// Until the next sweep sends the batch, as near as can be told.
export function msToNextSweep(now = Date.now()): number {
  const last = activeAway()?.last_sweep_at;
  return last ? Math.max(0, fromSql(last) + SWEEP_EVERY_MS - now) : 0;
}
