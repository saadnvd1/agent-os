/**
 * A machine's name as the Connect service tells it, made safe to show next
 * to a pairing code: plain text on one line, no direction overrides, short,
 * and with no digits at all once it holds 4 or more, so a lying service
 * can't name a machine "type 482, 913" and have the person type that
 * instead. Separators can't be enumerated ("482 and 913"), so the count is
 * over the whole name.
 */

export const NAME_MAX = 48;

// C0/C1 controls, zero-width and joiner characters, bidi embeddings,
// overrides and isolates, the byte-order mark.
const INVISIBLE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu;
// Digits, any script.
const DIGIT = /\p{Nd}/gu;
const MAX_DIGITS = 3;

export const UNNAMED = "Unnamed machine";

export function cleanMachineName(raw: unknown): string {
  if (typeof raw !== "string") return UNNAMED;
  let s = raw
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .replace(INVISIBLE, "")
    .trim();
  if ((s.match(DIGIT) ?? []).length > MAX_DIGITS) s = s.replace(DIGIT, "#");
  if ([...s].length > NAME_MAX)
    s = `${[...s].slice(0, NAME_MAX - 1).join("")}…`;
  return s || UNNAMED;
}
