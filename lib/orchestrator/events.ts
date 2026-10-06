/**
 * The orchestrator's events, kept in `orchestrator_events` by key. A key
 * present means the orchestrator has been told, or will be; so a restart
 * diffs against the same set and resends nothing.
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
  created_at: string;
  delivered_at: string | null;
}

// Marks that the workspace's state as of its first look is known, so what
// was already true then isn't sent as news.
const BASELINE = "baseline";

const iso = (ms: number) => new Date(ms).toISOString();

// Diffs the workspace's conditions against what's stored: new ones are
// queued, ones no longer true are forgotten unless sticky. Returns the lines
// newly queued.
export function recordConditions(
  workspaceId: string,
  conditions: Condition[],
  now = Date.now()
): string[] {
  const rows = db
    .prepare(
      `SELECT key, sticky FROM orchestrator_events WHERE workspace_id = ?`
    )
    .all(workspaceId) as { key: string; sticky: number }[];
  const known = new Set(rows.map((r) => r.key));
  const baseline = !known.has(BASELINE);
  const current = new Map(conditions.map((c) => [c.key, c]));
  const insert = db.prepare(
    `INSERT OR IGNORE INTO orchestrator_events
       (workspace_id, key, subject, line, sticky, created_at, delivered_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  const forget = db.prepare(
    `DELETE FROM orchestrator_events WHERE workspace_id = ? AND key = ?`
  );
  const queued: string[] = [];
  db.transaction(() => {
    if (baseline)
      insert.run(workspaceId, BASELINE, null, BASELINE, 1, iso(now), iso(now));
    for (const c of current.values()) {
      if (known.has(c.key)) continue;
      insert.run(
        workspaceId,
        c.key,
        c.subject,
        c.line,
        c.sticky ? 1 : 0,
        iso(now),
        baseline ? iso(now) : null
      );
      if (!baseline) queued.push(c.line);
    }
    for (const r of rows)
      if (!r.sticky && !current.has(r.key)) forget.run(workspaceId, r.key);
    // Sticky facts about sessions and stack items that are gone.
    db.prepare(
      `DELETE FROM orchestrator_events WHERE workspace_id = ? AND sticky = 1
         AND subject IS NOT NULL
         AND subject NOT IN (SELECT id FROM sessions)
         AND subject NOT IN (SELECT id FROM stack_items)
         AND subject NOT IN (SELECT id FROM stacks)`
    ).run(workspaceId);
  })();
  return queued;
}

export function pendingEvents(workspaceId: string): EventRow[] {
  return db
    .prepare(
      `SELECT * FROM orchestrator_events
       WHERE workspace_id = ? AND delivered_at IS NULL ORDER BY id`
    )
    .all(workspaceId) as EventRow[];
}

export function lastDeliveredAt(workspaceId: string): number {
  const row = db
    .prepare(
      `SELECT MAX(delivered_at) AS at FROM orchestrator_events
       WHERE workspace_id = ? AND key != ?`
    )
    .get(workspaceId, BASELINE) as { at: string | null };
  return row.at ? Date.parse(row.at) : 0;
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

export function forgetWorkspaceEvents(workspaceId: string): void {
  db.prepare(`DELETE FROM orchestrator_events WHERE workspace_id = ?`).run(
    workspaceId
  );
}
