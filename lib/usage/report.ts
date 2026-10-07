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
