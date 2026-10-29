// The commands and skills last used from the composer, newest first. Kept in
// the browser: a short list that only matters to this device.

const KEY = "agentos:recent-commands";
const MAX = 5;

export function pushRecent(list: string[], name: string): string[] {
  return [name, ...list.filter((n) => n !== name)].slice(0, MAX);
}

export function loadRecent(): string[] {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(v)
      ? v.filter((n): n is string => typeof n === "string").slice(0, MAX)
      : [];
  } catch {
    return [];
  }
}

export function saveRecent(name: string): string[] {
  const next = pushRecent(loadRecent(), name);
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {}
  return next;
}
