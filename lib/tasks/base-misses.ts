/**
 * Linked machines that couldn't find a queued task's base branch, so the
 * next placement skips them for a while. In memory on purpose: after a
 * restart the worst case is one more try there, which costs no attempt.
 */

const TTL_MS = 30 * 60_000;

interface Miss {
  base: string;
  name: string;
  at: number;
}

const g = globalThis as unknown as {
  __agentosBaseMisses?: Map<string, Map<string, Miss>>;
};
const misses = (g.__agentosBaseMisses ??= new Map());

export function noteBaseMiss(
  rowId: string,
  hostId: string,
  name: string,
  base: string,
  now = Date.now()
): void {
  const row = misses.get(rowId) ?? new Map<string, Miss>();
  row.set(hostId, { base, name, at: now });
  misses.set(rowId, row);
}

function live(rowId: string, now: number): [string, Miss][] {
  const row = misses.get(rowId);
  if (!row) return [];
  for (const [host, m] of row) if (now - m.at > TTL_MS) row.delete(host);
  if (!row.size) misses.delete(rowId);
  return [...row];
}

export const avoidsHost = (rowId: string, hostId: string, now = Date.now()) =>
  live(rowId, now).some(([h]) => h === hostId);

// Why the task stays where it is, or null.
export function baseMissText(rowId: string, now = Date.now()): string | null {
  const [first] = live(rowId, now);
  return first ? `${first[1].name} can't find its base ${first[1].base}` : null;
}

export function forgetBaseMisses(rowId: string): void {
  misses.delete(rowId);
}
