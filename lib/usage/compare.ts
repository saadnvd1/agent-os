/**
 * Claude-only tasks against routed ones, side by side: what each cost
 * (tokens, dollars at list prices, share of the plan's window, wall time)
 * and how it went (CI green on the first push, the first review passing,
 * gate failures, commits after the first review, merged or dropped). Built
 * on the usage ledgers (chat_turns, and check_runs for the gate's own runs)
 * and the orchestrator's checks: no record of its own.
 *
 * A task's cohort is the provider its own turns (planning and implementing)
 * ran on: anthropic is the baseline; one that used two is "mixed". Its
 * reviews and scope checks count toward its cost, whatever they ran on.
 */

import { db } from "../db";
import { effectiveModels } from "../models/config";
import { ANTHROPIC } from "../models/roles";
import type { ModelPrice } from "../models/providers";
import { planShares, rowModel, UNRECORDED } from "./cost";
import {
  addRow,
  emptySpend,
  type ModelTurnRow,
  type TokenSpend,
} from "./by-model";

export const SMALL_SAMPLE = 10;
const CHECK_ROLES = new Set(["review", "scope", "helper"]);

export interface CompareTurn extends ModelTurnRow {
  session_id: string;
  duration_ms: number | null;
  window_pct: number | null;
}

export interface TaskOutcome {
  id: string;
  status: string | null;
  // The decision on a plan step: null when none was recorded.
  planned: boolean | null;
  // The first finished CI run, and review, on its PR: passed or not; null
  // when it never had one (no PR, or not under an orchestrator).
  ciFirstGreen: boolean | null;
  reviewFirstPass: boolean | null;
  gateFailures: number;
  // Heads checked after its first review: the rework the review caused.
  rework: number;
}

export interface Rate {
  yes: number;
  of: number;
}

export interface Cohort {
  key: string;
  baseline: boolean;
  tasks: number;
  smallSample: boolean;
  spend: TokenSpend;
  // Points of the plan's 5-hour window (an estimate), Anthropic turns only.
  planPct: number;
  wallMs: number;
  ciFirstGreen: Rate;
  reviewFirstPass: Rate;
  gateFailures: number;
  rework: number;
  merged: Rate;
  dropped: Rate;
}

export interface RoleModelRow extends TokenSpend {
  role: string;
  provider: string;
  model: string;
  planPct: number;
  wallMs: number;
}

// Tasks split by whether the orchestrator chose a plan step for them.
export interface PlanSplitRow {
  key: "planned" | "unplanned" | "unstated";
  tasks: number;
  spend: TokenSpend;
}

export interface Comparison {
  from: number;
  to: number;
  cohorts: Cohort[];
  roles: RoleModelRow[];
  plans: PlanSplitRow[];
}

const rate = (): Rate => ({ yes: 0, of: 0 });
const count = (r: Rate, v: boolean | null) => {
  if (v === null) return;
  r.of += 1;
  if (v) r.yes += 1;
};

function cohortOf(turns: CompareTurn[]): string {
  const providers = new Set(
    turns
      .filter((t) => !CHECK_ROLES.has(t.role ?? ""))
      .map((t) => rowModel(t).provider)
  );
  if (providers.size === 0) return ANTHROPIC;
  return providers.size === 1 ? [...providers][0] : "mixed";
}

export function compareRuns(
  turns: CompareTurn[],
  outcomes: Map<string, TaskOutcome>,
  prices: Record<string, ModelPrice>,
  range: { from: number; to: number }
): Comparison {
  const shares = planShares(turns);
  const share = new Map(turns.map((t, i) => [t, shares[i]]));
  const inRange = turns.filter((t) => t.at >= range.from && t.at <= range.to);

  const byTask = new Map<string, CompareTurn[]>();
  for (const t of inRange)
    if (outcomes.has(t.session_id))
      byTask.set(t.session_id, [...(byTask.get(t.session_id) ?? []), t]);

  const cohorts = new Map<string, Cohort>();
  for (const [id, ts] of byTask) {
    const key = cohortOf(ts);
    let c = cohorts.get(key);
    if (!c)
      cohorts.set(
        key,
        (c = {
          key,
          baseline: key === ANTHROPIC,
          tasks: 0,
          smallSample: true,
          spend: emptySpend(),
          planPct: 0,
          wallMs: 0,
          ciFirstGreen: rate(),
          reviewFirstPass: rate(),
          gateFailures: 0,
          rework: 0,
          merged: rate(),
          dropped: rate(),
        })
      );
    const o = outcomes.get(id)!;
    c.tasks += 1;
    for (const t of ts) {
      addRow(c.spend, t, prices);
      c.planPct += share.get(t) ?? 0;
      c.wallMs += t.duration_ms ?? 0;
    }
    count(c.ciFirstGreen, o.ciFirstGreen);
    count(c.reviewFirstPass, o.reviewFirstPass);
    c.gateFailures += o.gateFailures;
    c.rework += o.rework;
    // Still running counts toward neither.
    const finished = o.status !== "running" && o.status !== null;
    count(c.merged, finished ? o.status === "merged" : null);
    count(c.dropped, finished ? o.status === "dropped" : null);
  }
  for (const c of cohorts.values()) c.smallSample = c.tasks < SMALL_SAMPLE;

  const plans = new Map<PlanSplitRow["key"], PlanSplitRow>();
  for (const [id, ts] of byTask) {
    const planned = outcomes.get(id)!.planned;
    const key =
      planned === null ? "unstated" : planned ? "planned" : "unplanned";
    let r = plans.get(key);
    if (!r) plans.set(key, (r = { key, tasks: 0, spend: emptySpend() }));
    r.tasks += 1;
    for (const t of ts) addRow(r.spend, t, prices);
  }

  const roles = new Map<string, RoleModelRow>();
  for (const t of inRange) {
    const { provider, model } = rowModel(t);
    const role = t.role ?? UNRECORDED;
    const k = `${role} ${provider}/${model}`;
    let r = roles.get(k);
    if (!r)
      roles.set(
        k,
        (r = { ...emptySpend(), role, provider, model, planPct: 0, wallMs: 0 })
      );
    addRow(r, t, prices);
    r.planPct += share.get(t) ?? 0;
    r.wallMs += t.duration_ms ?? 0;
  }

  return {
    ...range,
    // The baseline first, then the most tasks.
    cohorts: [...cohorts.values()].sort(
      (a, b) => Number(b.baseline) - Number(a.baseline) || b.tasks - a.tasks
    ),
    roles: [...roles.values()].sort(
      (a, b) => a.role.localeCompare(b.role) || b.costUsd - a.costUsd
    ),
    plans: (["planned", "unplanned", "unstated"] as const)
      .map((k) => plans.get(k))
      .filter((r): r is PlanSplitRow => !!r),
  };
}

// The ledger's turns, with the gate reviews and scope checks recorded in
// check_runs (lib/usage/check-runs) as turns of their own role.
export const LEDGER_SQL = `
  SELECT session_id, at, cost_usd, input_tokens, output_tokens,
    cache_read_tokens, cache_write_tokens, model, provider, role, duration_ms,
    window_pct FROM chat_turns WHERE at >= @from AND at <= @to
  UNION ALL
  SELECT session_id, at, cost_usd, input_tokens, output_tokens,
    cache_read_tokens, cache_write_tokens, model, provider, kind AS role,
    duration_ms, NULL AS window_pct FROM check_runs WHERE at >= @from AND at <= @to
  ORDER BY at`;

// The outcome of each task with turns in the range.
export function taskOutcomes(ids: string[]): Map<string, TaskOutcome> {
  const out = new Map<string, TaskOutcome>();
  if (!ids.length) return out;
  const marks = ids.map(() => "?").join(",");
  const tasks = db
    .prepare(
      `SELECT id, task_status, plan_decided FROM session_rows
       WHERE id IN (${marks}) AND task_status IS NOT NULL`
    )
    .all(...ids) as {
    id: string;
    task_status: string;
    plan_decided: number | null;
  }[];
  const checks = db
    .prepare(
      `SELECT id, session_id, sha, kind, status FROM orchestrator_checks
       WHERE session_id IN (${marks}) ORDER BY id`
    )
    .all(...ids) as {
    id: number;
    session_id: string;
    sha: string;
    kind: string;
    status: string;
  }[];
  const gates = db
    .prepare(
      `SELECT session_id, SUM(count) AS n FROM orchestrator_gate_failures
       WHERE session_id IN (${marks}) GROUP BY session_id`
    )
    .all(...ids) as { session_id: string; n: number }[];
  for (const t of tasks)
    out.set(t.id, {
      id: t.id,
      status: t.task_status,
      planned: t.plan_decided === null ? null : t.plan_decided === 1,
      ciFirstGreen: null,
      reviewFirstPass: null,
      gateFailures: 0,
      rework: 0,
    });
  const firstReview = new Map<string, number>();
  const reworked = new Map<string, Set<string>>();
  for (const c of checks) {
    const o = out.get(c.session_id);
    if (!o) continue;
    const settled = c.status === "pass" || c.status === "block";
    if (c.kind === "ci" && settled && o.ciFirstGreen === null)
      o.ciFirstGreen = c.status === "pass";
    if (c.kind === "review" && settled && o.reviewFirstPass === null) {
      o.reviewFirstPass = c.status === "pass";
      firstReview.set(c.session_id, c.id);
    }
    const after = firstReview.get(c.session_id);
    if (after !== undefined && c.id > after) {
      const shas = reworked.get(c.session_id) ?? new Set();
      shas.add(c.sha);
      reworked.set(c.session_id, shas);
    }
  }
  for (const [id, shas] of reworked) {
    // The reviewed head itself isn't rework.
    const o = out.get(id)!;
    const reviewed = checks.find((c) => c.id === firstReview.get(id))?.sha;
    o.rework = [...shas].filter((s) => s !== reviewed).length;
  }
  for (const g of gates) {
    const o = out.get(g.session_id);
    if (o) o.gateFailures = g.n;
  }
  return out;
}

export function comparisonReport(from: number, to: number): Comparison {
  // From a day earlier, so the first turn in range has a reading before it
  // to measure its share of the window from.
  const turns = db
    .prepare(LEDGER_SQL)
    .all({ from: from - 24 * 3600 * 1000, to }) as CompareTurn[];
  const ids = [
    ...new Set(turns.filter((t) => t.at >= from).map((t) => t.session_id)),
  ];
  return compareRuns(turns, taskOutcomes(ids), effectiveModels().prices, {
    from,
    to,
  });
}
