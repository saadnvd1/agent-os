import { db } from "@/lib/db";
import type { queueEventOnce } from "@/lib/orchestrator/events";
import { untrusted } from "@/lib/orchestrator/untrusted";
import type { HealthConfig } from "../config";
import { MIN } from "../types";
import { classById } from "./classes";
import { fixFor } from "./fixText";
import type { EnvFailureRow } from "./types";

const DAY = 24 * 60 * MIN;

export interface AlertDeps {
  queue: typeof queueEventOnce;
  workspaces: () => string[];
}

const one = (sql: string, ...args: unknown[]) =>
  (db.prepare(sql).get(...args) as { n: number }).n;

// The orchestrator hears of a class when it comes back after a quiet spell
// (or is new), or when enough sessions hit it inside a window. One event
// per row, and a burst at most once per window: the root cause is the thing
// to fix, so a hot class is one message, not one per session.
export function raiseAlerts(
  now: number,
  c: HealthConfig,
  deps: AlertDeps
): number {
  const window = c.envBurstHours * 60 * MIN;
  const quiet = c.envQuietDays * DAY;
  const fresh = db
    .prepare(
      `SELECT * FROM env_failures WHERE alerted IS NULL AND first_at >= ?
       ORDER BY first_at, id`
    )
    .all(now - window) as EnvFailureRow[];
  let raised = 0;
  for (const r of fresh) {
    const recent = one(
      `SELECT COUNT(*) AS n FROM env_failures WHERE class = ? AND first_at >= ?`,
      r.class,
      now - window
    );
    const bursting =
      recent >= c.envBurstSessions &&
      one(
        `SELECT COUNT(*) AS n FROM env_failures WHERE class = ?
         AND alerted = 'burst' AND alerted_at >= ?`,
        r.class,
        now - window
      ) === 0;
    const before = one(
      `SELECT COUNT(*) AS n FROM env_failures WHERE class = ? AND id != ?
       AND first_at < ? AND first_at >= ?`,
      r.class,
      r.id,
      r.first_at,
      r.first_at - quiet
    );
    const kind = bursting ? "burst" : before === 0 ? "recur" : null;
    if (!kind) continue;
    db.prepare(
      `UPDATE env_failures SET alerted = ?, alerted_at = ? WHERE id = ?`
    ).run(kind, now, r.id);
    const label = classById(r.class)?.label ?? r.class;
    const what =
      kind === "burst"
        ? `${recent} sessions in ${c.envBurstHours}h`
        : "back after a quiet spell";
    const line = `Environment failure (${label}): ${what}. Latest: ${untrusted("session command", r.command ?? r.class)}. A fix note ${fixFor(r.class) ? "goes to each session" : "is not defined"}; fix the root cause rather than keep nudging.`;
    const targets = r.workspace_id ? [r.workspace_id] : deps.workspaces();
    for (const ws of targets)
      deps.queue(
        ws,
        `env:${r.class}:${kind}:${r.id}`,
        `env:${r.class}`,
        line,
        now,
        false
      );
    raised++;
  }
  return raised;
}
