import {
  MAX_REFRESH_TOKENS,
  MIN_REFRESH_TOKENS,
} from "@/lib/chat/refresh-limits";

// A threshold's input, in thousands of tokens: off is 0; on takes a whole
// number in the range the server holds (lib/chat/refresh).
export function parseFreshStart(
  on: boolean,
  text: string
): { tokens: number } | { error: string } {
  if (!on) return { tokens: 0 };
  const k = Number(text.trim());
  const min = MIN_REFRESH_TOKENS / 1000;
  const max = MAX_REFRESH_TOKENS / 1000;
  if (!text.trim() || !Number.isInteger(k) || k < min || k > max)
    return { error: `A whole number from ${min} to ${max}` };
  return { tokens: k * 1000 };
}
