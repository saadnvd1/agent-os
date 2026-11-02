/** What clients and `aos children` show, and the numbers behind them. */

import { childrenOf, getGroup } from "./ledger";
import type { ChildRow, ChildView, GroupView } from "./types";

export const childView = (c: ChildRow): ChildView => ({
  id: c.child_session_id,
  n: 0,
  group: c.group_id,
  label: c.label,
  instruction: c.instruction,
  state: c.state,
  hold: c.hold,
  outcome: c.outcome,
  summary: c.summary,
  resultKind: c.result_kind,
  worktree: !!c.worktree,
  fellBack: !!c.fell_back,
  startedAt: c.started_at,
  settledAt: c.settled_at,
  delivered: c.delivered_at != null,
  asks: c.state === "needs_input" ? c.hold : null,
});

export function childrenView(parentId: string): {
  children: ChildView[];
  groups: GroupView[];
} {
  const rows = childrenOf(parentId);
  const seen = new Set<string>();
  const groups: GroupView[] = [];
  for (const c of rows) {
    if (seen.has(c.group_id)) continue;
    seen.add(c.group_id);
    const g = getGroup(c.group_id);
    if (g)
      groups.push({
        id: g.id,
        delivery: g.delivery,
        context: g.context,
        startedBy: g.started_by,
        createdAt: g.created_at,
        stats: null,
      });
  }
  return {
    children: rows.map((c, i) => ({ ...childView(c), n: i + 1 })),
    groups,
  };
}

const median = (xs: number[]): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

export interface ForkStats {
  children: number;
  settled: number;
  ok: number;
  failed: number;
  cancelled: number;
  implicit: number;
  fellBack: number;
  medianSeconds: number | null;
  tokensIn: number;
  tokensOut: number;
  cacheRead: number;
  heavyRuns: number;
  delivered: number;
  opened: number;
  mentioned: number;
}

export function statsOf(rows: ChildRow[]): ForkStats {
  const done = rows.filter((c) => c.state === "settled");
  const sum = (f: (c: ChildRow) => number | null) =>
    rows.reduce((n, c) => n + (f(c) ?? 0), 0);
  return {
    children: rows.length,
    settled: done.length,
    ok: done.filter((c) => c.outcome === "ok").length,
    failed: done.filter((c) => c.outcome === "failed").length,
    cancelled: done.filter((c) => c.outcome === "cancelled").length,
    implicit: done.filter(
      (c) => c.result_kind === "implicit" && c.outcome === "ok"
    ).length,
    fellBack: rows.filter((c) => c.fell_back).length,
    medianSeconds: median(
      done
        .filter((c) => c.started_at && c.settled_at)
        .map((c) => Math.round((c.settled_at! - c.started_at!) / 1000))
    ),
    tokensIn: sum((c) => c.tokens_in),
    tokensOut: sum((c) => c.tokens_out),
    cacheRead: sum((c) => c.cache_read),
    heavyRuns: sum((c) => c.heavy_runs),
    delivered: rows.filter((c) => c.delivered_at != null).length,
    opened: rows.filter((c) => c.used === "opened").length,
    mentioned: rows.filter((c) => c.used === "mentioned").length,
  };
}

export function statsText(s: ForkStats): string {
  const pct = (n: number) =>
    s.settled ? `${Math.round((n / s.settled) * 100)}%` : "-";
  return [
    `${s.children} children, ${s.settled} settled (${s.ok} ok, ${s.failed} failed, ${s.cancelled} cancelled)`,
    `returned without aos return: ${s.implicit} (${pct(s.implicit)}); started from a brief, not a fork: ${s.fellBack}`,
    `median time to settle: ${s.medianSeconds ?? "-"}s`,
    `tokens: ${s.tokensIn} in, ${s.tokensOut} out, ${s.cacheRead} cache read`,
    `heavy runs queued: ${s.heavyRuns}`,
    `results delivered: ${s.delivered}; opened in full: ${s.opened}; mentioned later: ${s.mentioned}`,
  ].join("\n");
}
