// A typed number, checked before anything is sent. An invalid one stays in
// the field with this message; nothing reaches the server.
export function parseSettingNumber(
  text: string,
  { min, max, integer = true }: { min: number; max?: number; integer?: boolean }
): { value: number } | { error: string } {
  const t = text.trim();
  const n = Number(t);
  const range = max === undefined ? `${min} or more` : `from ${min} to ${max}`;
  const msg = integer
    ? `Enter a whole number ${range}.`
    : `Enter a number ${range}.`;
  if (!t || !Number.isFinite(n)) return { error: msg };
  if (integer && !Number.isInteger(n)) return { error: msg };
  if (n < min || (max !== undefined && n > max)) return { error: msg };
  return { value: n };
}
