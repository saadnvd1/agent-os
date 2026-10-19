/**
 * What experiments cost and whether they earn it. Every model call an
 * experiment makes goes through experimentRun, which records it here and in
 * the usage ledger; non-model work (scripts, suggestions shown, accepted,
 * dismissed) is counted with countEvent.
 */

import { db } from "../db";
import {
  runClaude,
  type ClaudeRun,
  type ClaudeRunner,
} from "../orchestrator/claude-cli";
import type { RunUsage } from "../usage/check-runs";
import { recordLooseCall } from "../usage/calls";
import { dayKey } from "../usage/aggregate";
import { experimentOn } from ".";
import { getExperiment, type ExperimentId } from "./registry";

export type ExperimentEvent =
  "model" | "script" | "shown" | "accepted" | "dismissed" | "applied" | "error";

export interface MeterContext {
  trigger: string;
  sessionId?: string | null;
  workspaceId?: string | null;
  detail?: string | null;
}

const clip = (s: string | null | undefined, n = 120) =>
  s ? s.slice(0, n) : null;

function insert(
  id: ExperimentId,
  event: ExperimentEvent,
  ctx: MeterContext,
  u?: RunUsage,
  ok = true,
  at = Date.now()
): number {
  const info = db
    .prepare(
      `INSERT INTO experiment_usage (experiment_id, event, trigger, session_id, workspace_id, model, provider,
         input_tokens, cache_write_tokens, cache_read_tokens, output_tokens, cost_usd, duration_ms, ok, detail, at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      event,
      ctx.trigger,
      ctx.sessionId ?? null,
      ctx.workspaceId ?? null,
      u?.model ?? null,
      u ? (u.provider ?? "anthropic") : null,
      u?.inputTokens ?? 0,
      u?.cacheWriteTokens ?? 0,
      u?.cacheReadTokens ?? 0,
      u?.outputTokens ?? 0,
      u?.costUsd ?? 0,
      u?.durationMs ?? null,
      ok ? 1 : 0,
      clip(ctx.detail),
      at
    );
  return Number(info.lastInsertRowid);
}

function recordModel(id: ExperimentId, ctx: MeterContext, u: RunUsage) {
  try {
    const rowId = insert(id, "model", ctx, u);
    recordLooseCall({
      callKey: `experiment:${rowId}`,
      at: Date.now(),
      sessionId: ctx.sessionId ?? null,
      taskId: null,
      workspaceId: ctx.workspaceId ?? null,
      projectId: null,
      sessionName: getExperiment(id).name,
      role: `experiment:${id}`,
      kind: "helper",
      agentType: null,
      model: u.model,
      provider: u.provider ?? "anthropic",
      input: u.inputTokens,
      cacheRead: u.cacheReadTokens,
      cacheWrite5m: u.cacheWriteTokens,
      cacheWrite1h: 0,
      output: u.outputTokens,
      source: "helper",
    });
  } catch (e) {
    console.error(`[experiments] recording ${id}:`, e);
  }
}

/**
 * The only way an experiment calls a model. Returns null, having started
 * nothing, when the experiment is off. A failed run is recorded too (its
 * usage, or an error row when it reported none) and then thrown.
 */
export async function experimentRun(
  id: ExperimentId,
  ctx: MeterContext,
  run: ClaudeRun,
  runner: ClaudeRunner = runClaude
): Promise<unknown | null> {
  if (!experimentOn(id)) return null;
  let usage: RunUsage | null = null;
  try {
    const out = await runner({
      ...run,
      onUsage: (u) => {
        usage = u;
        run.onUsage?.(u);
      },
    });
    if (usage) recordModel(id, ctx, usage);
    return out;
  } catch (error) {
    try {
      if (usage) recordModel(id, ctx, usage);
      insert(
        id,
        "error",
        {
          ...ctx,
          detail: error instanceof Error ? error.message : String(error),
        },
        undefined,
        false
      );
    } catch (e) {
      console.error(`[experiments] recording ${id}:`, e);
    }
    throw error;
  }
}

/**
 * Non-model work. Does nothing when the experiment is off, unless `force`:
 * a person deciding on a card that is already on screen is still counted.
 */
export function countEvent(
  id: ExperimentId,
  event: Exclude<ExperimentEvent, "model">,
  ctx: MeterContext,
  force = false
): void {
  if (!force && !experimentOn(id)) return;
  try {
    insert(id, event, ctx);
  } catch (e) {
    console.error(`[experiments] counting ${id}:`, e);
  }
}

// Whether this session already has this event, so a hook runs once.
export function hasEvent(
  id: ExperimentId,
  sessionId: string,
  event: ExperimentEvent,
  trigger?: string
): boolean {
  return !!db
    .prepare(
      `SELECT 1 FROM experiment_usage WHERE experiment_id = ? AND session_id = ? AND event = ?
         AND (? IS NULL OR trigger = ?) LIMIT 1`
    )
    .get(id, sessionId, event, trigger ?? null, trigger ?? null);
}

export interface WindowTotals {
  calls: number;
  tokens: number;
  costUsd: number;
  scripts: number;
  shown: number;
  accepted: number;
  dismissed: number;
  // accepted / (accepted + dismissed); null with no decisions yet.
  acceptRate: number | null;
}

export interface UsageSummary {
  today: WindowTotals;
  d7: WindowTotals;
  d30: WindowTotals;
}

const DAY = 86_400_000;

export function startOfDay(now: number): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function windowTotals(id: ExperimentId, since: number): WindowTotals {
  const r = db
    .prepare(
      `SELECT
         coalesce(sum(event = 'model'), 0) AS calls,
         coalesce(sum(input_tokens + cache_write_tokens + cache_read_tokens + output_tokens), 0) AS tokens,
         coalesce(sum(cost_usd), 0) AS costUsd,
         coalesce(sum(event = 'script'), 0) AS scripts,
         coalesce(sum(event = 'shown'), 0) AS shown,
         coalesce(sum(event = 'accepted'), 0) AS accepted,
         coalesce(sum(event = 'dismissed'), 0) AS dismissed
       FROM experiment_usage WHERE experiment_id = ? AND at >= ?`
    )
    .get(id, since) as Omit<WindowTotals, "acceptRate">;
  const decided = r.accepted + r.dismissed;
  return { ...r, acceptRate: decided ? r.accepted / decided : null };
}

export function usageSummary(id: ExperimentId, now = Date.now()): UsageSummary {
  const today = startOfDay(now);
  return {
    today: windowTotals(id, today),
    d7: windowTotals(id, today - 6 * DAY),
    d30: windowTotals(id, today - 29 * DAY),
  };
}

export interface DayRow {
  day: string;
  calls: number;
  tokens: number;
  costUsd: number;
  accepted: number;
  dismissed: number;
}

export interface Breakdown {
  key: string;
  calls: number;
  tokens: number;
  costUsd: number;
}

export interface RecentEvent {
  at: number;
  event: string;
  trigger: string;
  model: string | null;
  tokens: number;
  costUsd: number;
  ok: boolean;
  detail: string | null;
}

export interface UsageDetail {
  days: DayRow[];
  byTrigger: Breakdown[];
  byModel: Breakdown[];
  recent: RecentEvent[];
}

export function usageDetail(id: ExperimentId, now = Date.now()): UsageDetail {
  const since = startOfDay(now) - 29 * DAY;
  const rows = db
    .prepare(
      `SELECT at, event, trigger, model, cost_usd AS costUsd,
         input_tokens + cache_write_tokens + cache_read_tokens + output_tokens AS tokens
       FROM experiment_usage WHERE experiment_id = ? AND at >= ?`
    )
    .all(id, since) as {
    at: number;
    event: string;
    trigger: string;
    model: string | null;
    costUsd: number;
    tokens: number;
  }[];
  const days = new Map<string, DayRow>();
  for (let i = 29; i >= 0; i--) {
    const day = dayKey(startOfDay(now) - i * DAY);
    days.set(day, {
      day,
      calls: 0,
      tokens: 0,
      costUsd: 0,
      accepted: 0,
      dismissed: 0,
    });
  }
  const trig = new Map<string, Breakdown>();
  const mod = new Map<string, Breakdown>();
  const add = (m: Map<string, Breakdown>, key: string, r: (typeof rows)[0]) => {
    const b = m.get(key) ?? { key, calls: 0, tokens: 0, costUsd: 0 };
    b.calls += r.event === "model" ? 1 : 0;
    b.tokens += r.tokens;
    b.costUsd += r.costUsd;
    m.set(key, b);
  };
  for (const r of rows) {
    const d = days.get(dayKey(r.at));
    if (d) {
      d.calls += r.event === "model" ? 1 : 0;
      d.tokens += r.tokens;
      d.costUsd += r.costUsd;
      d.accepted += r.event === "accepted" ? 1 : 0;
      d.dismissed += r.event === "dismissed" ? 1 : 0;
    }
    add(trig, r.trigger, r);
    if (r.event === "model") add(mod, r.model ?? "unrecorded", r);
  }
  const recent = db
    .prepare(
      `SELECT at, event, trigger, model, input_tokens + cache_write_tokens + cache_read_tokens + output_tokens AS tokens,
         cost_usd AS costUsd, ok, detail
       FROM experiment_usage WHERE experiment_id = ? ORDER BY at DESC, id DESC LIMIT 50`
    )
    .all(id) as (Omit<RecentEvent, "ok"> & { ok: number })[];
  return {
    days: [...days.values()],
    byTrigger: [...trig.values()],
    byModel: [...mod.values()],
    recent: recent.map((r) => ({ ...r, ok: !!r.ok })),
  };
}
