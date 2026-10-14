/**
 * An orchestrator's state about a task is keyed by the task's session id, and
 * a move gives the task a new one on each machine. Carrying re-keys that state
 * from the old id to the new, inside the transaction that makes the new row,
 * so the gates, failure counts, asks, scope changes and events judge the task
 * the same after a move. move-carry.test.ts fails on any table that keys by a
 * session and is in neither list, so a new one gets decided.
 */

import type Database from "better-sqlite3";
import { db } from "../db";

// table, column, and how the id sits in it: the whole value, `task:<id>`, or
// the tail of a `<condition>:<id>` key.
export const REKEYED = [
  ["orchestrator_starts", "target", "id"],
  ["orchestrator_checks", "session_id", "id"],
  ["orchestrator_gate_failures", "session_id", "id"],
  ["orchestrator_gate_failure_commits", "session_id", "id"],
  ["orchestrator_asks", "subject", "task"],
  ["brief_amendments", "session_id", "id"],
  ["task_pr_wakes", "session_id", "id"],
  ["orchestrator_events", "subject", "id"],
  ["orchestrator_events", "key", "tail"],
  ["check_runs", "session_id", "id"],
  ["away_actions", "subject", "task"],
  ["task_queue", "after_task", "id"],
] as const;

// Session-keyed columns that stay on the old id, and why.
export const KEPT = [
  ["orchestrator_event_log", "subject", "history is never rewritten"],
  ["stack_items", "session_id", "stacked tasks don't move"],
  ["task_pauses", "session_id", "a paused task can't be moved"],
  [
    "task_queue",
    "after_any",
    "a JSON list; a queued task waits on any of them",
  ],
] as const;

// Copied onto the new row where it has no value.
export const CARRIED_COLUMNS = [
  "started_by",
  "plan_decided",
  "plan_reason",
  "plan_phase",
  "model_provider",
  "model_overrides",
  "merge_armed_at",
  "merge_armed_seen",
  "rebased_from",
  "rebased_to",
  "rebase_asked_head",
  "pr_wake_since",
  "pr_url",
  "pr_number",
  "pr_status",
] as const;

/** The orchestration columns that make a session "an orchestrator's task". */
export const orchestrationOf = (session: Record<string, unknown>) =>
  Object.fromEntries(
    CARRIED_COLUMNS.map((c) => [c, session[c] ?? null] as const)
  );

export function carryTaskState(
  fromId: string,
  toId: string,
  handle: Database.Database = db
): void {
  if (fromId === toId) return;
  for (const [table, col, shape] of REKEYED) {
    if (shape === "id")
      handle
        .prepare(`UPDATE ${table} SET ${col} = ? WHERE ${col} = ?`)
        .run(toId, fromId);
    else if (shape === "task")
      handle
        .prepare(`UPDATE ${table} SET ${col} = ? WHERE ${col} = ?`)
        .run(`task:${toId}`, `task:${fromId}`);
    else
      handle
        .prepare(
          `UPDATE OR IGNORE ${table}
             SET ${col} = substr(${col}, 1, length(${col}) - ?) || ?
             WHERE ${col} LIKE ?`
        )
        .run(fromId.length, toId, `%:${fromId}`);
  }
  const from = handle
    .prepare(`SELECT * FROM sessions WHERE id = ?`)
    .get(fromId) as Record<string, unknown> | undefined;
  if (!from) return;
  const sets = [...CARRIED_COLUMNS, "task_since"]
    .map((c) => `${c} = COALESCE(${c}, @${c})`)
    .join(", ");
  handle.prepare(`UPDATE sessions SET ${sets} WHERE id = @id`).run({
    ...orchestrationOf(from),
    task_since: (from.task_since as string | null) ?? from.created_at ?? null,
    id: toId,
  });
}
