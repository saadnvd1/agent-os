/**
 * The pure half of the daily rollup: one day from its inputs, and any span
 * of days as ratios of sums. No database, so the Usage view can use it too.
 * A day keeps its sums as well as its ratios, so three days' cost per PR is
 * their total cost over their total PRs, never a mean of three ratios.
 */

import { weighted, family, type TokenRow } from "./weights";

export interface CallGroup extends TokenRow {
  kind: string;
  role: string | null;
  calls: number;
  // Calls with a known context size, and those of them above 200k.
  ctxKnown: number;
  over200k: number;
}

export interface Rollup {
  day: string;
  weighted: number;
  // Everything but a person's own sessions.
  work: number;
  review: number;
  orchestrator: number;
  mix: { opus: number; sonnet: number; haiku: number };
  calls: number;
  ctxKnown: number;
  over200k: number;
  merged: number;
  clean: number;
  fixRounds: number;
  escalations: number;
  scopeChanges: number;
  escapes: number | null;
  weeklyPct: number | null;
  weeklyEstimated: boolean;
}

export interface DayInputs {
  day: string;
  groups: CallGroup[];
  merged: number;
  clean: number;
  fixRounds: number;
  escalations: number;
  scopeChanges: number;
  escapes: number | null;
  weeklyPct: number | null;
  weeklyEstimated: boolean;
}

export function computeRollup(i: DayInputs): Rollup {
  const r: Rollup = {
    day: i.day,
    weighted: 0,
    work: 0,
    review: 0,
    orchestrator: 0,
    mix: { opus: 0, sonnet: 0, haiku: 0 },
    calls: 0,
    ctxKnown: 0,
    over200k: 0,
    merged: i.merged,
    clean: i.clean,
    fixRounds: i.fixRounds,
    escalations: i.escalations,
    scopeChanges: i.scopeChanges,
    escapes: i.escapes,
    weeklyPct: i.weeklyPct,
    weeklyEstimated: i.weeklyEstimated,
  };
  for (const g of i.groups) {
    const w = weighted(g);
    if (w <= 0 && g.provider && g.provider !== "anthropic") continue;
    r.weighted += w;
    r.mix[family(g.model)] += w;
    r.calls += g.calls;
    r.ctxKnown += g.ctxKnown;
    r.over200k += g.over200k;
    if (g.role !== "interactive") r.work += w;
    if (g.kind === "review" || g.kind === "gate") r.review += w;
    if (g.role === "orchestrator") r.orchestrator += w;
  }
  return r;
}

// A span of days, as ratios of sums.
export interface Span {
  days: number;
  weighted: number;
  work: number;
  merged: number;
  clean: number;
  costPerMerged: number | null;
  costPerClean: number | null;
  cleanRate: number | null;
  reviewPerPr: number | null;
  over200kShare: number | null;
  orchestratorShare: number | null;
  opusShare: number | null;
  fixRoundsPerPr: number | null;
  escalations: number;
  scopeChanges: number;
  escapes: number | null;
}

const ratio = (a: number, b: number) => (b > 0 ? a / b : null);

export function spanOf(rows: Rollup[]): Span {
  const sum = (f: (r: Rollup) => number) => rows.reduce((t, r) => t + f(r), 0);
  const work = sum((r) => r.work);
  const merged = sum((r) => r.merged);
  const clean = sum((r) => r.clean);
  const weightedTotal = sum((r) => r.weighted);
  const known = rows.filter((r) => r.escapes !== null);
  return {
    days: rows.length,
    weighted: weightedTotal,
    work,
    merged,
    clean,
    costPerMerged: ratio(work, merged),
    costPerClean: ratio(work, clean),
    cleanRate: ratio(clean, merged),
    reviewPerPr: ratio(
      sum((r) => r.review),
      merged
    ),
    over200kShare: ratio(
      sum((r) => r.over200k),
      sum((r) => r.ctxKnown)
    ),
    orchestratorShare: ratio(
      sum((r) => r.orchestrator),
      weightedTotal
    ),
    opusShare: ratio(
      sum((r) => r.mix.opus),
      weightedTotal
    ),
    fixRoundsPerPr: ratio(
      sum((r) => r.fixRounds),
      merged
    ),
    escalations: sum((r) => r.escalations),
    scopeChanges: sum((r) => r.scopeChanges),
    escapes: known.length
      ? known.reduce((t, r) => t + (r.escapes ?? 0), 0)
      : null,
  };
}
