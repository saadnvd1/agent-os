// The workspace setting's input: off is no limit; on takes a whole number
// from 1, the same rule the server holds (lib/workspaces.ts).
export function parseTaskLimit(
  on: boolean,
  text: string
): { limit: number | null } | { error: string } {
  if (!on) return { limit: null };
  const n = Number(text.trim());
  if (!text.trim() || !Number.isInteger(n) || n < 1)
    return { error: "A whole number from 1" };
  return { limit: n };
}

// What the menu says about the current setting.
export const taskLimitLabel = (limit: number | null | undefined) =>
  limit ? `${limit} at a time` : "Off";
