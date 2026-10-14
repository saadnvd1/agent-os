/**
 * Which model each kind of subagent ran on: its calls and tokens by subagent
 * type and the model the response came from, so a routing change shows up
 * in what actually ran.
 */

import { db } from "../db";

export interface SubagentModelRow {
  agentType: string;
  model: string;
  calls: number;
  tokens: number;
}

export function subagentModelUsage(
  days: number,
  now = Date.now()
): SubagentModelRow[] {
  return db
    .prepare(
      `SELECT COALESCE(agent_type, 'unknown') AS agentType, model, COUNT(*) AS calls,
         SUM(input_tokens + cache_read_tokens + cache_write_5m_tokens
           + cache_write_1h_tokens + output_tokens) AS tokens
       FROM usage_calls
       WHERE kind IN ('sub', 'review') AND at >= ?
       GROUP BY agentType, model
       ORDER BY calls DESC, agentType, model`
    )
    .all(now - days * 86_400_000) as SubagentModelRow[];
}
