/**
 * One day of usage and quality, from the ledger and the quality readers.
 * Rows keep their sums as well as their ratios, so any span of days
 * aggregates as a ratio of sums: three days' cost per PR is their total cost
 * over their total PRs, never a mean of three ratios.
 */

import { db } from "../db";
import { currentWindow } from "./rate-limits";
import {
  escalationsIn,
  escapesIn,
  mergedTasks,
  qualityOf,
  scopeChangesIn,
  type Gh,
} from "./quality";

export * from "./span";
import { computeRollup, type CallGroup, type Rollup } from "./span";

export const dayKey = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
export const dayStart = (day: string) => {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d).getTime();
};
export const dayEnd = (day: string) => {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d + 1).getTime();
};

function groupsIn(from: number, to: number): CallGroup[] {
  return db
    .prepare(
      `SELECT kind, role, model, provider, COUNT(*) AS calls,
         SUM(input_tokens) AS input_tokens, SUM(cache_read_tokens) AS cache_read_tokens,
         SUM(cache_write_5m_tokens) AS cache_write_5m_tokens,
         SUM(cache_write_1h_tokens) AS cache_write_1h_tokens,
         SUM(output_tokens) AS output_tokens,
         SUM(ctx_tokens IS NOT NULL) AS ctxKnown, SUM(ctx_tokens > 200000) AS over200k
       FROM usage_calls WHERE at >= ? AND at < ?
       GROUP BY kind, role, model, provider`
    )
    .all(from, to) as CallGroup[];
}

export async function rollupDay(
  day: string,
  now = Date.now(),
  gh?: Gh
): Promise<Rollup> {
  const from = dayStart(day);
  const to = dayEnd(day);
  const tasks = mergedTasks(from, to);
  const q = qualityOf(tasks);
  const weekly = currentWindow("seven_day", Math.min(now, to));
  return computeRollup({
    day,
    groups: groupsIn(from, to),
    merged: tasks.length,
    clean: q.filter((t) => t.clean).length,
    fixRounds: q.reduce((t, x) => t + x.fixRounds, 0),
    escalations: escalationsIn(from, to),
    scopeChanges: scopeChangesIn(from, to),
    escapes: await escapesIn(tasks, gh),
    weeklyPct: weekly?.pct ?? null,
    weeklyEstimated: weekly?.estimated ?? false,
  });
}

export function saveRollup(r: Rollup, final: boolean, now = Date.now()): void {
  db.prepare(
    `INSERT INTO usage_rollups (day, data, final, computed_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(day) DO UPDATE SET data = excluded.data, final = excluded.final,
       computed_at = excluded.computed_at`
  ).run(r.day, JSON.stringify(r), final ? 1 : 0, now);
}

export function loadRollups(limit = 60): Rollup[] {
  return (
    db
      .prepare(`SELECT data FROM usage_rollups ORDER BY day DESC LIMIT ?`)
      .all(limit) as { data: string }[]
  )
    .map((r) => JSON.parse(r.data) as Rollup)
    .reverse();
}
