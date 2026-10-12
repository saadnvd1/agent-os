/**
 * The per-response usage ledger (usage_calls): one row per Claude API
 * response, keyed by its message id. Claude Code writes one assistant message
 * per content block under the same id, with usage growing, so a row is
 * upserted keeping the highest of each field.
 */

import { db } from "../db";
import { ANTHROPIC, sessionRole } from "../models/roles";
import { ctxOf, weighted, type TokenRow } from "./weights";
import type { CallKind, CallRow, CallSource, CallUsage } from "./types";

export type { CallKind, CallRow, CallSource, CallUsage };

interface RawUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_creation?: {
    ephemeral_5m_input_tokens?: number;
    ephemeral_1h_input_tokens?: number;
  } | null;
}

const n = (v: unknown) => (typeof v === "number" && v > 0 ? v : 0);

// The usage on an assistant message, or null for a synthetic one (an error
// the CLI wrote itself) or one with no id.
export function callFromAssistant(
  message: { id?: string; model?: string; usage?: RawUsage } | undefined,
  kind: CallKind,
  agentType: string | null,
  at = Date.now()
): CallUsage | null {
  if (!message?.id || !message.usage) return null;
  if (!message.model || message.model === "<synthetic>") return null;
  const u = message.usage;
  const split = u.cache_creation;
  const w1h = n(split?.ephemeral_1h_input_tokens);
  // Without the split, the whole write counts as the 5-minute kind.
  const w5m = split
    ? n(split.ephemeral_5m_input_tokens)
    : n(u.cache_creation_input_tokens);
  return {
    callKey: message.id,
    at,
    kind,
    agentType,
    model: message.model,
    input: n(u.input_tokens),
    cacheRead: n(u.cache_read_input_tokens),
    cacheWrite5m: w5m,
    cacheWrite1h: w1h,
    output: n(u.output_tokens),
  };
}

export function upsertCall(r: CallRow): void {
  db.prepare(
    `INSERT INTO usage_calls (call_key, at, session_id, task_id, workspace_id, project_id,
       session_name, role, kind, agent_type, model, provider, input_tokens, cache_read_tokens,
       cache_write_5m_tokens, cache_write_1h_tokens, output_tokens, ctx_tokens, source)
     VALUES (@callKey, @at, @sessionId, @taskId, @workspaceId, @projectId, @sessionName, @role,
       @kind, @agentType, @model, @provider, @input, @cacheRead, @cacheWrite5m, @cacheWrite1h,
       @output, @ctx, @source)
     ON CONFLICT(call_key) DO UPDATE SET
       input_tokens = MAX(input_tokens, excluded.input_tokens),
       cache_read_tokens = MAX(cache_read_tokens, excluded.cache_read_tokens),
       cache_write_5m_tokens = MAX(cache_write_5m_tokens, excluded.cache_write_5m_tokens),
       cache_write_1h_tokens = MAX(cache_write_1h_tokens, excluded.cache_write_1h_tokens),
       output_tokens = MAX(output_tokens, excluded.output_tokens),
       ctx_tokens = MAX(COALESCE(ctx_tokens, 0), COALESCE(excluded.ctx_tokens, 0)),
       session_id = COALESCE(session_id, excluded.session_id),
       task_id = COALESCE(task_id, excluded.task_id),
       workspace_id = COALESCE(workspace_id, excluded.workspace_id),
       project_id = COALESCE(project_id, excluded.project_id),
       session_name = COALESCE(session_name, excluded.session_name),
       role = COALESCE(role, excluded.role)`
  ).run(r);
}

export interface SessionContext {
  sessionId: string;
  taskId: string | null;
  workspaceId: string | null;
  projectId: string | null;
  sessionName: string | null;
  role: string | null;
  provider: string;
}

// Who a session's calls belong to. Read per call: a plan becomes
// implementation, and a name changes.
export function sessionContext(sessionId: string): SessionContext {
  const s = db
    .prepare(
      `SELECT name, workspace_id, project_id, model_provider, role, task_status,
         plan_phase, started_by FROM sessions WHERE id = ?`
    )
    .get(sessionId) as
    | {
        name: string;
        workspace_id: string | null;
        project_id: string | null;
        model_provider: string | null;
        role: string | null;
        task_status: string | null;
        plan_phase: string | null;
        started_by: string | null;
      }
    | undefined;
  return {
    sessionId,
    taskId: s?.task_status ? sessionId : null,
    workspaceId: s?.workspace_id ?? null,
    projectId: s?.project_id ?? null,
    sessionName: s?.name ?? null,
    role: s ? sessionRole(s) : null,
    provider: s?.model_provider ?? ANTHROPIC,
  };
}

export function recordCall(
  call: CallUsage,
  ctx: SessionContext,
  source: CallSource
): void {
  const row: CallRow = {
    ...call,
    sessionId: ctx.sessionId,
    taskId: ctx.taskId,
    workspaceId: ctx.workspaceId,
    projectId: ctx.projectId,
    sessionName: ctx.sessionName,
    role: ctx.role,
    provider: ctx.provider,
    ctx: 0,
    source,
  };
  row.ctx = ctxOf({
    model: row.model,
    input_tokens: row.input,
    cache_read_tokens: row.cacheRead,
    cache_write_5m_tokens: row.cacheWrite5m,
    cache_write_1h_tokens: row.cacheWrite1h,
    output_tokens: row.output,
  });
  upsertCall(row);
}

// A call that never goes through a conversation (a check run).
export function recordLooseCall(
  r: Omit<CallRow, "ctx" | "provider"> & { provider?: string }
): void {
  upsertCall({ ...r, provider: r.provider ?? ANTHROPIC, ctx: null });
}

// check_runs rows not yet in the ledger, as calls of their own.
export function backfillCheckRuns(): number {
  const rows = db
    .prepare(
      `SELECT c.id, c.workspace_id, c.session_id, c.label, c.kind, c.model, c.provider,
         c.input_tokens, c.cache_write_tokens, c.cache_read_tokens, c.output_tokens, c.at,
         s.project_id FROM check_runs c LEFT JOIN sessions s ON s.id = c.session_id
       WHERE NOT EXISTS (SELECT 1 FROM usage_calls u WHERE u.call_key = 'check_run:' || c.id)`
    )
    .all() as {
    id: number;
    workspace_id: string;
    session_id: string;
    label: string;
    kind: string;
    model: string | null;
    provider: string | null;
    input_tokens: number;
    cache_write_tokens: number;
    cache_read_tokens: number;
    output_tokens: number;
    at: number;
    project_id: string | null;
  }[];
  db.transaction(() => {
    for (const c of rows) recordCheckRunCall(c.id, c);
  })();
  return rows.length;
}

export function recordCheckRunCall(
  id: number,
  c: {
    workspace_id: string;
    session_id: string;
    label: string;
    kind: string;
    model: string | null;
    provider: string | null;
    input_tokens: number;
    cache_write_tokens: number;
    cache_read_tokens: number;
    output_tokens: number;
    at: number;
    project_id?: string | null;
  }
): void {
  recordLooseCall({
    callKey: `check_run:${id}`,
    at: c.at,
    sessionId: c.session_id,
    taskId: c.session_id ? sessionContext(c.session_id).taskId : null,
    workspaceId: c.workspace_id,
    projectId: c.project_id ?? null,
    sessionName: c.label,
    role: `gate-${c.kind}`,
    kind: "gate",
    agentType: null,
    model: c.model,
    provider: c.provider ?? ANTHROPIC,
    input: c.input_tokens,
    cacheRead: c.cache_read_tokens,
    cacheWrite5m: c.cache_write_tokens,
    cacheWrite1h: 0,
    output: c.output_tokens,
    source: "check_run",
  });
}

// What each task cost so far in weighted tokens: its own session, its
// subagents and its gate reviews. One grouped query for the whole list.
export function taskCosts(ids: string[]): Map<string, number> {
  const out = new Map<string, number>();
  if (!ids.length) return out;
  const marks = ids.map(() => "?").join(",");
  const rows = db
    .prepare(
      `SELECT task_id, model, provider, SUM(input_tokens) AS input_tokens,
         SUM(cache_read_tokens) AS cache_read_tokens,
         SUM(cache_write_5m_tokens) AS cache_write_5m_tokens,
         SUM(cache_write_1h_tokens) AS cache_write_1h_tokens,
         SUM(output_tokens) AS output_tokens
       FROM usage_calls WHERE task_id IN (${marks}) GROUP BY task_id, model, provider`
    )
    .all(...ids) as (TokenRow & { task_id: string })[];
  for (const r of rows)
    out.set(r.task_id, (out.get(r.task_id) ?? 0) + weighted(r));
  return out;
}
