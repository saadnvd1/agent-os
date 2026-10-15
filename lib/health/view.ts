// What the UI gets of an anomaly. Plain data, no Node imports: the panel and
// the routes share it.

import type { AnomalyRow, Area, CheckId, Severity, Verdict } from "./types";

// "11m", "2h 5m".
export function duration(ms: number): string {
  const m = Math.round(ms / 60_000);
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
}

export interface AnomalyView {
  id: number;
  check: CheckId;
  area: Area;
  severity: Severity;
  subject: string;
  line: string;
  openedAt: number;
  closedAt: number | null;
  closeReason: string | null;
  hits: number;
  verdict: Verdict | null;
  // A watcher was woken and hasn't answered yet.
  judging: boolean;
  tokens: number;
  needsYou: boolean;
  phoned: boolean;
}

export interface CheckSummary {
  check: CheckId;
  opened: number;
  real: number;
  medianOpenMs: number | null;
  wakes: number;
  tokens: number;
}

export interface HealthView {
  // When this was read, so "open so far" is computed from the server's clock.
  now: number;
  open: AnomalyView[];
  history: AnomalyView[];
  summary: CheckSummary[];
  needsYou: number;
}

const parse = (raw: string | null): Verdict | null => {
  try {
    return raw ? (JSON.parse(raw) as Verdict) : null;
  } catch {
    return null;
  }
};

export function toView(row: AnomalyRow): AnomalyView {
  const verdict = parse(row.verdict);
  return {
    id: row.id,
    check: row.check_id,
    area: row.area,
    severity: row.severity,
    subject: row.subject,
    line: row.line,
    openedAt: row.opened_at,
    closedAt: row.closed_at,
    closeReason: row.close_reason,
    hits: row.hits,
    verdict,
    judging:
      row.woken_at !== null && verdict === null && row.closed_at === null,
    tokens: (row.tokens_in ?? 0) + (row.tokens_out ?? 0),
    needsYou: verdict?.real === true && verdict.saadOnly === true,
    phoned: row.phoned_at !== null,
  };
}

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

export function summarize(rows: AnomalyRow[]): CheckSummary[] {
  const by = new Map<CheckId, AnomalyRow[]>();
  for (const r of rows) by.set(r.check_id, [...(by.get(r.check_id) ?? []), r]);
  return [...by.entries()]
    .map(([check, rs]) => ({
      check,
      opened: rs.length,
      real: rs.filter((r) => parse(r.verdict)?.real === true).length,
      medianOpenMs: median(
        rs
          .filter((r) => r.closed_at !== null)
          .map((r) => (r.closed_at as number) - r.opened_at)
      ),
      wakes: rs.filter((r) => r.woken_at !== null).length,
      tokens: rs.reduce(
        (n, r) => n + (r.tokens_in ?? 0) + (r.tokens_out ?? 0),
        0
      ),
    }))
    .sort((a, b) => b.opened - a.opened);
}

export function healthView(
  open: AnomalyRow[],
  closed: AnomalyRow[],
  week: AnomalyRow[]
): HealthView {
  const views = open.map(toView);
  return {
    now: Date.now(),
    open: views,
    history: closed.map(toView),
    summary: summarize(week),
    needsYou: views.filter((v) => v.needsYou).length,
  };
}
