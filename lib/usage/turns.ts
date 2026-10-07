/**
 * What each chat turn cost, written as its result arrives. The agent only
 * reports running totals, so each turn is the difference from the totals the
 * session last saw.
 */

import { db, type Session } from "../db";
import type { UsageTotals } from "../chat/events";
import { totalTokens, turnDelta } from "../chat/context";

function lastTotals(sessionId: string): UsageTotals | null {
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

export function recordTurn(
  session: Pick<Session, "id" | "name" | "workspace_id">,
  totals: UsageTotals,
  at = Date.now()
): void {
  const turn = turnDelta(lastTotals(session.id), totals);
  db.transaction(() => {
    db.prepare(`UPDATE sessions SET chat_usage = ? WHERE id = ?`).run(
      JSON.stringify(totals),
      session.id
    );
    // A local command (/context, /mcp) spends nothing.
    if (turn.costUsd <= 0 && totalTokens(turn) <= 0) return;
    const current = db
      .prepare(`SELECT name, workspace_id FROM sessions WHERE id = ?`)
      .get(session.id) as
      | { name: string; workspace_id: string | null }
      | undefined;
    db.prepare(
      `INSERT INTO chat_turns (session_id, session_name, workspace_id, at, cost_usd,
         input_tokens, output_tokens, cache_read_tokens, cache_write_tokens)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      session.id,
      current?.name ?? session.name,
      current?.workspace_id ?? session.workspace_id,
      at,
      turn.costUsd,
      turn.inputTokens,
      turn.outputTokens,
      turn.cacheReadTokens,
      turn.cacheWriteTokens
    );
  })();
}
