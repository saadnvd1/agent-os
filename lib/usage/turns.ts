/**
 * What each chat turn cost, written as its result arrives. The agent only
 * reports running totals, so each turn is the difference from the totals its
 * worker last saw (lib/chat/worker/host.ts keeps them).
 */

import { db, type Session } from "../db";
import type { UsageTotals } from "../chat/events";
import { totalTokens, turnDelta } from "../chat/context";
import { readUsage } from "../orchestrator/usage";
import { ANTHROPIC, sessionRole } from "../models/roles";

// Where a worker's totals start: a resumed conversation continues from the
// totals its transcript saved, which the last worker stored; a new one
// starts from nothing.
export function startingTotals(
  sessionId: string,
  resumed: boolean
): UsageTotals | null {
  return resumed ? savedTotals(sessionId) : null;
}

function savedTotals(sessionId: string): UsageTotals | null {
  const row = db
    .prepare(`SELECT chat_usage FROM sessions WHERE id = ?`)
    .get(sessionId) as { chat_usage: string | null } | undefined;
  if (!row?.chat_usage) return null;
  try {
    return JSON.parse(row.chat_usage) as UsageTotals;
  } catch {
    return null;
  }
}

// The plan's 5-hour window when a turn on it ended, for its share of the
// plan (lib/usage/compare): unknown when the statusline isn't sampling.
export function planWindowPct(): number | null {
  const u = readUsage();
  return "window" in u && u.window ? u.window.pct : null;
}

// Records the turn, with the model, provider and role it ran as, and
// returns the totals to measure the next one from.
export function recordTurn(
  session: Pick<Session, "id" | "name" | "workspace_id">,
  prev: UsageTotals | null,
  totals: UsageTotals,
  at = Date.now(),
  durationMs: number | null = null,
  windowPct: () => number | null = planWindowPct
): UsageTotals {
  const turn = turnDelta(prev, totals);
  db.transaction(() => {
    db.prepare(`UPDATE sessions SET chat_usage = ? WHERE id = ?`).run(
      JSON.stringify(totals),
      session.id
    );
    // A local command (/context, /mcp) spends nothing.
    if (turn.costUsd <= 0 && totalTokens(turn) <= 0) return;
    const current = db
      .prepare(
        `SELECT name, workspace_id, model, model_provider, role, task_status,
           plan_phase, started_by FROM sessions WHERE id = ?`
      )
      .get(session.id) as
      | Pick<
          Session,
          | "name"
          | "workspace_id"
          | "model"
          | "model_provider"
          | "role"
          | "task_status"
          | "plan_phase"
          | "started_by"
        >
      | undefined;
    const provider = current?.model_provider ?? ANTHROPIC;
    insertTurn({
      sessionId: session.id,
      sessionName: current?.name ?? session.name,
      workspaceId: current?.workspace_id ?? session.workspace_id,
      at,
      turn,
      model: current?.model ?? null,
      provider,
      role: current ? sessionRole(current) : null,
      durationMs,
      windowPct: provider === ANTHROPIC ? windowPct() : null,
    });
  })();
  return totals;
}

// When a compaction ran: "mid_turn" is the agent's own, at its auto-compact
// window, while it worked; the rest happen between turns.
export type CompactionPhase = "mid_turn" | "between_turns";
export const compactionPhase = (trigger: string): CompactionPhase =>
  trigger === "auto" ? "mid_turn" : "between_turns";

// Records one compaction: who ran it ("auto" is the agent's own, at its
// auto-compact window; "threshold" and "stale" are AgentOS's before a
// message; "manual" is a /compact someone typed), which phase that was,
// and the context before and after when the agent said.
export function recordCompaction(
  session: Pick<Session, "id" | "name" | "workspace_id">,
  c: { trigger: string; before?: number; after?: number },
  at = Date.now()
): void {
  const current = db
    .prepare(`SELECT name, workspace_id FROM sessions WHERE id = ?`)
    .get(session.id) as
    | { name: string; workspace_id: string | null }
    | undefined;
  db.prepare(
    `INSERT INTO chat_compactions (session_id, session_name, workspace_id, at, trigger, phase, before_tokens, after_tokens)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    session.id,
    current?.name ?? session.name,
    current?.workspace_id ?? session.workspace_id,
    at,
    c.trigger,
    compactionPhase(c.trigger),
    c.before ?? null,
    c.after ?? null
  );
}

export interface TurnRecord {
  sessionId: string;
  sessionName: string;
  workspaceId: string | null;
  at: number;
  turn: UsageTotals;
  model: string | null;
  provider: string;
  role: string | null;
  durationMs: number | null;
  windowPct: number | null;
}

// One row of the usage ledger: a chat turn, or a one-shot check's run.
export function insertTurn(r: TurnRecord): void {
  const { turn } = r;
  db.prepare(
    `INSERT INTO chat_turns (session_id, session_name, workspace_id, at, cost_usd,
       input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,
       model, provider, role, duration_ms, window_pct)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    r.sessionId,
    r.sessionName,
    r.workspaceId,
    r.at,
    turn.costUsd,
    turn.inputTokens,
    turn.outputTokens,
    turn.cacheReadTokens,
    turn.cacheWriteTokens,
    r.model,
    r.provider,
    r.role,
    r.durationMs,
    r.windowPct
  );
}
