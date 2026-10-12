/**
 * What the orchestrator's one-shot checks cost: each `claude -p` run of the
 * independent reviewer and the scope check, read from its JSON result.
 * They run with --no-session-persistence and leave no transcript, so this
 * is the only record of their tokens.
 */

import { db } from "../db";
import { recordCheckRunCall } from "./calls";
import { formatTokens } from "../chat/context";

export interface RunUsage {
  model: string | null;
  // Where the model ran (lib/models); Anthropic when absent.
  provider?: string;
  inputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
  outputTokens: number;
  costUsd: number;
  durationMs: number | null;
}

interface ModelUsage {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadInputTokens?: number;
  cacheCreationInputTokens?: number;
  costUSD?: number;
}

const n = (v: unknown) => (typeof v === "number" && v > 0 ? v : 0);

// The usage in a `claude -p --output-format json` result, or null when it
// carries none. Per-model usage covers every model the run used; the model
// named is the one that cost the most.
export function runUsageOf(result: unknown): RunUsage | null {
  if (!result || typeof result !== "object") return null;
  const r = result as {
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      cache_read_input_tokens?: number;
      cache_creation_input_tokens?: number;
    };
    modelUsage?: Record<string, ModelUsage>;
    total_cost_usd?: number;
    duration_ms?: number;
  };
  const models = Object.entries(r.modelUsage ?? {});
  if (!r.usage && !models.length) return null;
  const durationMs = n(r.duration_ms) || null;
  if (models.length) {
    const sum = (k: keyof ModelUsage) =>
      models.reduce((t, [, m]) => t + n(m[k]), 0);
    const [model] = models.reduce((a, b) =>
      n(b[1].costUSD) > n(a[1].costUSD) ? b : a
    );
    return {
      model,
      inputTokens: sum("inputTokens"),
      cacheWriteTokens: sum("cacheCreationInputTokens"),
      cacheReadTokens: sum("cacheReadInputTokens"),
      outputTokens: sum("outputTokens"),
      costUsd: n(r.total_cost_usd) || sum("costUSD"),
      durationMs,
    };
  }
  const u = r.usage!;
  return {
    model: null,
    inputTokens: n(u.input_tokens),
    cacheWriteTokens: n(u.cache_creation_input_tokens),
    cacheReadTokens: n(u.cache_read_input_tokens),
    outputTokens: n(u.output_tokens),
    costUsd: n(r.total_cost_usd),
    durationMs,
  };
}

export interface CheckRunTarget {
  workspaceId: string;
  // The task's session id, or an external PR's id.
  sessionId: string;
  // How the Usage page names it: "task add-a", "PR o/r#5".
  label: string;
  prNumber: number | null;
  sha: string;
  kind: "review" | "scope";
}

export function recordCheckRun(
  target: CheckRunTarget,
  u: RunUsage,
  at = Date.now()
): void {
  const info = db
    .prepare(
      `INSERT INTO check_runs (workspace_id, session_id, label, pr_number, sha, kind, model, provider,
       input_tokens, cache_write_tokens, cache_read_tokens, output_tokens, cost_usd, duration_ms, at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      target.workspaceId,
      target.sessionId,
      target.label,
      target.prNumber,
      target.sha,
      target.kind,
      u.model,
      u.provider ?? "anthropic",
      u.inputTokens,
      u.cacheWriteTokens,
      u.cacheReadTokens,
      u.outputTokens,
      u.costUsd,
      u.durationMs,
      at
    );
  try {
    recordCheckRunCall(Number(info.lastInsertRowid), {
      workspace_id: target.workspaceId,
      session_id: target.sessionId,
      label: target.label,
      kind: target.kind,
      model: u.model,
      provider: u.provider ?? "anthropic",
      input_tokens: u.inputTokens,
      cache_write_tokens: u.cacheWriteTokens,
      cache_read_tokens: u.cacheReadTokens,
      output_tokens: u.outputTokens,
      at,
    });
  } catch (e) {
    // The nightly backfill picks it up.
    console.error(`[check-runs] ledger ${target.label}:`, e);
  }
}

// A recorder for one check, that never lets a write break the check.
export function checkRunRecorder(target: CheckRunTarget) {
  return (u: RunUsage) => {
    try {
      recordCheckRun(target, u);
    } catch (e) {
      console.error(`[check-runs] recording ${target.label}:`, e);
    }
  };
}

export interface CheckRunTotals {
  runs: number;
  tokens: number;
  costUsd: number;
  durationMs: number;
  models: string[];
}

// Everything the checks of one commit cost, every part and retry.
export function checkRunTotals(
  sessionId: string,
  sha: string
): CheckRunTotals | null {
  const row = db
    .prepare(
      `SELECT count(*) AS runs,
         coalesce(sum(input_tokens + cache_write_tokens + cache_read_tokens + output_tokens), 0) AS tokens,
         coalesce(sum(cost_usd), 0) AS costUsd,
         coalesce(sum(duration_ms), 0) AS durationMs,
         group_concat(DISTINCT model) AS models
       FROM check_runs WHERE session_id = ? AND sha = ?`
    )
    .get(sessionId, sha) as Omit<CheckRunTotals, "models"> & {
    models: string | null;
  };
  if (!row.runs) return null;
  return { ...row, models: row.models ? row.models.split(",") : [] };
}

// "2 runs · 412k tokens · $0.84 · 3m 10s · claude-opus-5-5"
export function describeCheckRuns(t: CheckRunTotals): string {
  const s = Math.round(t.durationMs / 1000);
  const time = s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`;
  return [
    `${t.runs} run${t.runs === 1 ? "" : "s"}`,
    `${formatTokens(t.tokens)} tokens`,
    `$${t.costUsd.toFixed(2)}`,
    time,
    ...t.models,
  ].join(" · ");
}
