/**
 * Text from a guest is cleaned here again, on this machine, whatever Connect
 * did to it: nothing from the wire is shown on a card or reaches the agent
 * without passing through. Mirrors Connect's Live::Text.
 */

const INVISIBLE =
  /[\p{Cf}\p{Default_Ignorable_Code_Point}\p{Zl}\p{Zp}⠀\u{1D159}\u{E0000}-\u{E0FFF}]/gu;
const SPACES = /\p{Zs}/gu;
const CONTROL = /[\u0000-\u001F\u007F-\u009F]/g;
const CONTROL_KEEPING_NEWLINE = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/g;
const MARK_RUN = /\p{M}{3,}/u;
const SCRIPTS = [
  /\p{Script=Latin}/u,
  /\p{Script=Cyrillic}/u,
  /\p{Script=Greek}/u,
];

export const MAX_NAME = 40;
export const MAX_SUGGESTION = 2000;

const wellFormed = (s: string) => s.isWellFormed();

/** A guest's name: one line, 1-40 characters, or null. */
export function cleanName(input: unknown): string | null {
  if (typeof input !== "string" || !wellFormed(input)) return null;
  if (input.length > MAX_NAME * 8) return null;
  const s = input
    .normalize("NFC")
    .replace(SPACES, " ")
    .replace(INVISIBLE, "")
    .replace(CONTROL, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!s || [...s].length > MAX_NAME || !/[\p{L}\p{N}]/u.test(s)) return null;
  if (MARK_RUN.test(s) || SCRIPTS.filter((r) => r.test(s)).length > 1)
    return null;
  return s;
}

/** A block of text (a suggestion): newlines and tabs kept, or null. */
export function cleanBody(input: unknown, max = MAX_SUGGESTION): string | null {
  if (typeof input !== "string" || !wellFormed(input)) return null;
  if (input.length > max * 8) return null;
  const s = input
    .normalize("NFC")
    .replace(/\r/g, "")
    .replace(SPACES, " ")
    .replace(INVISIBLE, "")
    .replace(CONTROL_KEEPING_NEWLINE, "")
    .trim();
  if (!s || [...s].length > max) return null;
  return s;
}
