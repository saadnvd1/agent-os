/**
 * Chat spend over a range, by day, session and workspace. Costs are summed
 * in whole micro-dollars so every breakdown adds up to the same total.
 */

export interface TurnRow {
  session_id: string;
  session_name: string;
  workspace_id: string | null;
  at: number;
  cost_usd: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
}

export type UsageRange = "today" | "7d" | "30d";
export const USAGE_RANGES: UsageRange[] = ["today", "7d", "30d"];
const RANGE_DAYS: Record<UsageRange, number> = { today: 1, "7d": 7, "30d": 30 };

export interface Spend {
  costUsd: number;
  tokens: number;
  turns: number;
}

export interface UsageReport {
  range: UsageRange;
  since: number;
  total: Spend;
  days: (Spend & { date: string })[];
  sessions: (Spend & {
    id: string;
    name: string;
    workspaceId: string | null;
  })[];
  workspaces: (Spend & { id: string | null; name: string })[];
}

const micros = (usd: number) => Math.round(usd * 1_000_000);

interface Acc {
  micros: number;
  tokens: number;
  turns: number;
}
const acc = (): Acc => ({ micros: 0, tokens: 0, turns: 0 });
const spend = (a: Acc): Spend => ({
  costUsd: a.micros / 1_000_000,
  tokens: a.tokens,
  turns: a.turns,
});

// A day in the server's own time zone, which is the user's.
export function dayKey(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Midnight at the start of the range: today, or 6 or 29 days before it.
export function rangeStart(range: UsageRange, now = Date.now()): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - (RANGE_DAYS[range] - 1));
  return d.getTime();
}

export function aggregateUsage(
  rows: TurnRow[],
  range: UsageRange,
  workspaceNames: Record<string, string>,
  now = Date.now()
): UsageReport {
  const since = rangeStart(range, now);
  const total = acc();
  const days = new Map<string, Acc>();
  for (let t = since; t <= now; ) {
    days.set(dayKey(t), acc());
    const next = new Date(t);
    next.setDate(next.getDate() + 1);
    t = next.getTime();
  }
  const sessions = new Map<
    string,
    Acc & { name: string; workspaceId: string | null }
  >();
  const workspaces = new Map<string | null, Acc>();

  for (const r of rows) {
    if (r.at < since || r.at > now) continue;
    const m = micros(r.cost_usd);
    const tokens =
      r.input_tokens +
      r.output_tokens +
      r.cache_read_tokens +
      r.cache_write_tokens;
    const day = days.get(dayKey(r.at)) ?? acc();
    days.set(dayKey(r.at), day);
    let s = sessions.get(r.session_id);
    if (!s) {
      s = { ...acc(), name: r.session_name, workspaceId: r.workspace_id };
      sessions.set(r.session_id, s);
    }
    // The newest name and workspace a session had.
    s.name = r.session_name;
    s.workspaceId = r.workspace_id;
    let w = workspaces.get(r.workspace_id);
    if (!w) workspaces.set(r.workspace_id, (w = acc()));
    for (const a of [total, day, s, w]) {
      a.micros += m;
      a.tokens += tokens;
      a.turns += 1;
    }
  }

  const byCost = <T extends Spend>(a: T, b: T) =>
    b.costUsd - a.costUsd || b.tokens - a.tokens;
  return {
    range,
    since,
    total: spend(total),
    days: [...days].map(([date, a]) => ({ date, ...spend(a) })),
    sessions: [...sessions]
      .map(([id, s]) => ({
        id,
        name: s.name,
        workspaceId: s.workspaceId,
        ...spend(s),
      }))
      .sort(byCost),
    workspaces: [...workspaces]
      .map(([id, w]) => ({
        id,
        name: id ? (workspaceNames[id] ?? "Deleted workspace") : "No workspace",
        ...spend(w),
      }))
      .sort(byCost),
  };
}
