// The Away window's bounds, in minutes, for the server (./activity) and
// the Settings form alike. Client-safe: no database.
export const DEFAULT_WINDOW_MINUTES = 60;
export const MIN_WINDOW_MINUTES = 10;
export const MAX_WINDOW_MINUTES = 24 * 60;

// The form's text as minutes, or null when it's out of bounds.
export function parseWindow(text: string): number | null {
  const n = Number(text.trim());
  return text.trim() &&
    Number.isInteger(n) &&
    n >= MIN_WINDOW_MINUTES &&
    n <= MAX_WINDOW_MINUTES
    ? n
    : null;
}
