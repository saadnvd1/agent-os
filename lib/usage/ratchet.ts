/**
 * The ratchet. The baseline is the first week of rollups, and from then on
 * only ever moves to a better value. An alert fires, once, when cost per
 * merged PR or the clean-merge rate has drifted past the configured margin,
 * naming the supporting metric that moved most.
 */

import { db } from "../db";
import { spanOf, type Rollup, type Span } from "./span";
import type { UsageConfig } from "./config";

export type Direction = "lower" | "higher";

// The better of the two. A missing or invalid candidate keeps what was.
export function ratchet(
  prev: number | null,
  candidate: number | null,
  better: Direction
): number | null {
  if (candidate === null || !Number.isFinite(candidate)) return prev;
  if (prev === null || !Number.isFinite(prev)) return candidate;
  return better === "lower"
    ? Math.min(prev, candidate)
    : Math.max(prev, candidate);
}

// What the baseline is judged on.
export const HEADLINE = {
  costPerMerged: "lower",
  costPerClean: "lower",
  cleanRate: "higher",
} as const satisfies Record<string, Direction>;
export type HeadlineKey = keyof typeof HEADLINE;

// Supporting metrics, each where lower is better, per PR where it is a count.
export interface Supporting {
  reviewPerPr: number | null;
  over200kShare: number | null;
  orchestratorShare: number | null;
  opusShare: number | null;
  fixRoundsPerPr: number | null;
  escalationsPerPr: number | null;
  scopeChangesPerPr: number | null;
  escapesPerPr: number | null;
}

export const SUPPORTING_LABELS: Record<keyof Supporting, string> = {
  reviewPerPr: "review cost per PR",
  over200kShare: "share of calls above 200k context",
  orchestratorShare: "orchestrator share",
  opusShare: "Opus share of the model mix",
  fixRoundsPerPr: "fix rounds per PR",
  escalationsPerPr: "escalations per PR",
  scopeChangesPerPr: "scope changes per PR",
  escapesPerPr: "escapes per PR",
};

const per = (n: number | null, merged: number) =>
  n !== null && merged > 0 ? n / merged : null;

export function supportingOf(s: Span): Supporting {
  return {
    reviewPerPr: s.reviewPerPr,
    over200kShare: s.over200kShare,
    orchestratorShare: s.orchestratorShare,
    opusShare: s.opusShare,
    fixRoundsPerPr: s.fixRoundsPerPr,
    escalationsPerPr: per(s.escalations, s.merged),
    scopeChangesPerPr: per(s.scopeChanges, s.merged),
    escapesPerPr: per(s.escapes, s.merged),
  };
}

export interface Baseline {
  values: Record<HeadlineKey, number | null>;
  supporting: Supporting;
  setAt: number;
}

// The next baseline. None until `cfg.baselineDays` complete days exist; the
// first is those first days, and each night after it, the trailing week of
// days is ratcheted in. The supporting snapshot follows cost per merged PR:
// it is replaced only when that improves.
export function nextBaseline(
  prev: Baseline | null,
  complete: Rollup[],
  cfg: UsageConfig,
  now = Date.now()
): Baseline | null {
  const days = [...complete].sort((a, b) => a.day.localeCompare(b.day));
  if (days.length < cfg.baselineDays) return prev;
  if (!prev) {
    const s = spanOf(days.slice(0, cfg.baselineDays));
    return {
      values: {
        costPerMerged: s.costPerMerged,
        costPerClean: s.costPerClean,
        cleanRate: s.cleanRate,
      },
      supporting: supportingOf(s),
      setAt: now,
    };
  }
  const s = spanOf(days.slice(-cfg.baselineDays));
  const values = { ...prev.values };
  for (const k of Object.keys(HEADLINE) as HeadlineKey[])
    values[k] = ratchet(prev.values[k], s[k], HEADLINE[k]);
  const improved =
    s.costPerMerged !== null &&
    (prev.values.costPerMerged === null ||
      s.costPerMerged < prev.values.costPerMerged);
  return {
    values,
    supporting: improved ? supportingOf(s) : prev.supporting,
    setAt: improved ? now : prev.setAt,
  };
}

export interface Alert {
  kind: "cost" | "quality";
  message: string;
}

const round = (x: number) => Math.round(x * 1e6) / 1e6;

// The supporting metric that moved furthest the wrong way since the baseline.
export function biggestMover(
  base: Supporting,
  now: Supporting
): { label: string; change: string } | null {
  let best: { key: keyof Supporting; score: number } | null = null;
  for (const key of Object.keys(base) as (keyof Supporting)[]) {
    const b = base[key];
    const c = now[key];
    if (b === null || c === null) continue;
    const score = b > 0 ? (c - b) / b : c > 0 ? 1 : 0;
    if (score > 0 && (!best || score > best.score)) best = { key, score };
  }
  if (!best) return null;
  const b = base[best.key] as number;
  return {
    label: SUPPORTING_LABELS[best.key],
    change: b > 0 ? `+${Math.round(best.score * 100)}%` : "up from none",
  };
}

// Conditions that hold now, over the last `avgDays` complete days.
export function evaluateAlerts(
  complete: Rollup[],
  baseline: Baseline | null,
  cfg: UsageConfig
): Alert[] {
  if (!baseline) return [];
  const days = [...complete]
    .sort((a, b) => a.day.localeCompare(b.day))
    .slice(-cfg.avgDays);
  const s = spanOf(days);
  if (days.length < cfg.avgDays || s.merged < cfg.minMerges) return [];
  const mover = biggestMover(baseline.supporting, supportingOf(s));
  const moved = mover ? ` Biggest mover: ${mover.label} ${mover.change}.` : "";
  const out: Alert[] = [];
  const baseCost = baseline.values.costPerMerged;
  if (s.costPerMerged !== null && baseCost !== null && baseCost > 0) {
    const over = round(((s.costPerMerged - baseCost) / baseCost) * 100);
    if (over > cfg.costPct)
      out.push({
        kind: "cost",
        message: `Usage: cost per merged PR, ${cfg.avgDays}-day average, is ${Math.round(over)}% over baseline.${moved}`,
      });
  }
  const baseClean = baseline.values.cleanRate;
  if (s.cleanRate !== null && baseClean !== null) {
    const under = round((baseClean - s.cleanRate) * 100);
    if (under > cfg.cleanPoints)
      out.push({
        kind: "quality",
        message: `Usage: clean-merge rate, ${cfg.avgDays}-day average, is ${Math.round(under)} points under baseline.${moved}`,
      });
  }
  return out;
}

// Which firing alerts are new (to send), and which open ones have cleared.
export function nextAlertState(
  open: string[],
  firing: Alert[]
): { notify: Alert[]; clear: string[] } {
  const now = new Set(firing.map((a) => a.kind));
  return {
    notify: firing.filter((a) => !open.includes(a.kind)),
    clear: open.filter((k) => !now.has(k as Alert["kind"])),
  };
}

export function loadBaseline(): Baseline | null {
  const rows = db
    .prepare(`SELECT metric, value, set_at, supporting FROM usage_baseline`)
    .all() as {
    metric: string;
    value: number;
    set_at: number;
    supporting: string | null;
  }[];
  if (!rows.length) return null;
  const values: Baseline["values"] = {
    costPerMerged: null,
    costPerClean: null,
    cleanRate: null,
  };
  let supporting: Supporting | null = null;
  let setAt = 0;
  for (const r of rows) {
    if (r.metric in values) values[r.metric as HeadlineKey] = r.value;
    if (r.metric === "costPerMerged" && r.supporting)
      supporting = JSON.parse(r.supporting) as Supporting;
    setAt = Math.max(setAt, r.set_at);
  }
  return {
    values,
    supporting: supporting ?? supportingOf(spanOf([])),
    setAt,
  };
}

export function saveBaseline(b: Baseline): void {
  db.transaction(() => {
    for (const k of Object.keys(HEADLINE) as HeadlineKey[]) {
      const v = b.values[k];
      if (v === null) continue;
      db.prepare(
        `INSERT INTO usage_baseline (metric, value, set_at, supporting) VALUES (?, ?, ?, ?)
         ON CONFLICT(metric) DO UPDATE SET value = excluded.value, set_at = excluded.set_at,
           supporting = excluded.supporting`
      ).run(
        k,
        v,
        b.setAt,
        k === "costPerMerged" ? JSON.stringify(b.supporting) : null
      );
    }
  })();
}

export function openAlerts(): string[] {
  return (
    db
      .prepare(`SELECT kind FROM usage_alerts WHERE cleared_at IS NULL`)
      .all() as { kind: string }[]
  ).map((r) => r.kind);
}

export function applyAlertState(
  state: { notify: Alert[]; clear: string[] },
  now = Date.now()
): void {
  db.transaction(() => {
    for (const a of state.notify)
      db.prepare(
        `INSERT INTO usage_alerts (kind, opened_at, cleared_at, message) VALUES (?, ?, NULL, ?)
         ON CONFLICT(kind) DO UPDATE SET opened_at = excluded.opened_at, cleared_at = NULL,
           message = excluded.message`
      ).run(a.kind, now, a.message);
    for (const k of state.clear)
      db.prepare(`UPDATE usage_alerts SET cleared_at = ? WHERE kind = ?`).run(
        now,
        k
      );
  })();
}
