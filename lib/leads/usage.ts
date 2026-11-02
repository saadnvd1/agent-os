import { db } from "@/lib/db";
import { leadKindOf } from "./roles";
import type { LeadUsage } from "./types";

// What each standing chat in a workspace spent since `sinceMs`, from the
// calls every chat worker already records (lib/usage/calls). An adopted
// lead counts only from when it became one, so week one is measured, not
// guessed.
export function leadUsage(workspaceId: string, sinceMs: number): LeadUsage[] {
  const rows = db
    .prepare(
      `SELECT s.id AS session_id, s.role, s.lead_kind,
              COUNT(c.id) AS calls,
              COALESCE(SUM(c.input_tokens), 0) AS input,
              COALESCE(SUM(c.cache_read_tokens), 0) AS cache_read,
              COALESCE(SUM(c.cache_write_5m_tokens + c.cache_write_1h_tokens), 0) AS cache_write,
              COALESCE(SUM(c.output_tokens), 0) AS output
       FROM sessions s
       LEFT JOIN usage_calls c ON c.session_id = s.id
         AND c.at >= MAX(?, COALESCE(
           CAST(strftime('%s', s.lead_since) AS INTEGER) * 1000, 0))
       WHERE s.workspace_id = ? AND s.role IN ('orchestrator', 'lead', 'chief')
       GROUP BY s.id
       ORDER BY s.role, s.lead_kind`
    )
    .all(sinceMs, workspaceId) as {
    session_id: string;
    role: string;
    lead_kind: string | null;
    calls: number;
    input: number;
    cache_read: number;
    cache_write: number;
    output: number;
  }[];
  return rows.map((r) => ({
    sessionId: r.session_id,
    leadKind: leadKindOf(r) ?? r.role,
    role: r.role,
    calls: r.calls,
    inputTokens: r.input,
    cacheReadTokens: r.cache_read,
    cacheWriteTokens: r.cache_write,
    outputTokens: r.output,
  }));
}
