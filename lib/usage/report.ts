import { db } from "../db";
import { listWorkspaces } from "../workspaces";
import {
  aggregateUsage,
  rangeStart,
  type TurnRow,
  type UsageRange,
} from "./aggregate";

export function usageReport(range: UsageRange, now = Date.now()) {
  const rows = db
    .prepare(
      `SELECT session_id, session_name, workspace_id, at, cost_usd, input_tokens,
         output_tokens, cache_read_tokens, cache_write_tokens
       FROM chat_turns WHERE at >= ? ORDER BY at`
    )
    .all(rangeStart(range, now)) as TurnRow[];
  const names = Object.fromEntries(listWorkspaces().map((w) => [w.id, w.name]));
  return aggregateUsage(rows, range, names, now);
}

// What the orchestrator's reviewer and scope check cost over the range
// (lib/usage/check-runs), by PR: a "turn" is one run.
export function checkRunReport(range: UsageRange, now = Date.now()) {
  const rows = db
    .prepare(
      `SELECT session_id, label, pr_number, workspace_id, at, cost_usd, input_tokens,
         output_tokens, cache_read_tokens, cache_write_tokens
       FROM check_runs WHERE at >= ? ORDER BY at`
    )
    .all(rangeStart(range, now)) as (Omit<TurnRow, "session_name"> & {
    label: string;
    pr_number: number | null;
  })[];
  const named: TurnRow[] = rows.map(({ label, pr_number, ...r }) => ({
    ...r,
    // An external PR's label already names it.
    session_name:
      pr_number === null || label.startsWith("PR ")
        ? label
        : `${label} · PR #${pr_number}`,
  }));
  const names = Object.fromEntries(listWorkspaces().map((w) => [w.id, w.name]));
  return aggregateUsage(named, range, names, now);
}
