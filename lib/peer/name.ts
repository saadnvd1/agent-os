/**
 * A machine's name as the Connect service tells it, made safe to show next
 * to a pairing code: plain text on one line, no direction overrides, short,
 * and with no run of 4 or more digits, so a lying service can't name a
 * machine "type 482 913" and have the person type that instead.
 */

export const NAME_MAX = 48;

// C0/C1 controls, zero-width and joiner characters, bidi embeddings,
// overrides and isolates, the byte-order mark.
const INVISIBLE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu;
// Digits, any script, 4 or more with at most one separator between each.
const DIGIT_RUN = /\p{Nd}(?:[\s.\-_/:·•]?\p{Nd}){3,}/gu;

export const UNNAMED = "Unnamed machine";

export function cleanMachineName(raw: unknown): string {
  if (typeof raw !== "string") return UNNAMED;
  let s = raw
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .replace(INVISIBLE, "")
    .trim();
  s = s.replace(DIGIT_RUN, (run) => run.replace(/\p{Nd}/gu, "#"));
  if ([...s].length > NAME_MAX)
    s = `${[...s].slice(0, NAME_MAX - 1).join("")}…`;
  return s || UNNAMED;
}
