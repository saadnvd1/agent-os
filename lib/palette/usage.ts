export interface UsageEntry {
  count: number;
  last: number;
}
export type Usage = Record<string, UsageEntry>;

export const USAGE_KEY = "agentOS-palette-usage";
export const MAX_USAGE = 200;
const DAY = 86_400_000;
const HALF_LIFE_DAYS = 14;
// Uses at which the count part of the boost tops out.
const SATURATES_AT = 20;

// How strongly past use favours an item, 0 to 1: more uses count more (with
// diminishing returns) and the whole fades by half every two weeks.
export function usageBoost(entry: UsageEntry | undefined, now: number): number {
  if (!entry) return 0;
  const age = Math.max(0, now - entry.last) / DAY;
  const weight = Math.min(
    1,
    Math.log2(1 + entry.count) / Math.log2(1 + SATURATES_AT)
  );
  return weight * Math.pow(0.5, age / HALF_LIFE_DAYS);
}

// The usage with one more run of `id`, keeping the MAX_USAGE items that
// matter most right now.
export function recordUse(usage: Usage, id: string, now: number): Usage {
  const next: Usage = {
    ...usage,
    [id]: { count: (usage[id]?.count ?? 0) + 1, last: now },
  };
  const ids = Object.keys(next);
  if (ids.length <= MAX_USAGE) return next;
  const keep = ids
    .sort((a, b) => usageBoost(next[b], now) - usageBoost(next[a], now))
    .slice(0, MAX_USAGE);
  return Object.fromEntries(keep.map((k) => [k, next[k]]));
}

// The ids last run most recently, newest first.
export function recentIds(usage: Usage, limit: number): string[] {
  return Object.entries(usage)
    .sort((a, b) => b[1].last - a[1].last)
    .slice(0, limit)
    .map(([id]) => id);
}

function valid(e: unknown): e is UsageEntry {
  const u = e as UsageEntry | null;
  return (
    !!u && Number.isFinite(u.count) && Number.isFinite(u.last) && u.count > 0
  );
}

export function loadUsage(): Usage {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(USAGE_KEY) ?? "{}");
    if (!raw || typeof raw !== "object") return {};
    const usage: Usage = {};
    for (const [id, e] of Object.entries(raw)) if (valid(e)) usage[id] = e;
    return usage;
  } catch {
    return {};
  }
}

export function saveUsage(usage: Usage): void {
  try {
    localStorage.setItem(USAGE_KEY, JSON.stringify(usage));
  } catch {
    // Private mode or a full disk: ranking just forgets.
  }
}

// Records a run in storage and returns the new usage.
export function noteUse(id: string, now = Date.now()): Usage {
  const next = recordUse(loadUsage(), id, now);
  saveUsage(next);
  return next;
}
