const KEY = "agentOS-recent-conversation-searches";
export const MAX_RECENT = 6;

export function parseRecent(raw: string | null): string[] {
  try {
    const v: unknown = JSON.parse(raw ?? "[]");
    if (!Array.isArray(v)) return [];
    return v
      .filter((x): x is string => typeof x === "string")
      .slice(0, MAX_RECENT);
  } catch {
    return [];
  }
}

// Newest first, each search once.
export function withRecent(list: string[], q: string): string[] {
  const text = q.trim();
  if (!text) return list;
  return [text, ...list.filter((x) => x !== text)].slice(0, MAX_RECENT);
}

export function loadRecent(): string[] {
  try {
    return parseRecent(localStorage.getItem(KEY));
  } catch {
    return [];
  }
}

export function saveRecent(list: string[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {}
}
