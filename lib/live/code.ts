import crypto from "crypto";

/** The code is never logged, so nothing here prints it. */

/** Six digits, zero-padded so 123 is "000123". */
export function generateCode(): string {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
}

/** The shape Connect checks: spaces and dashes dropped, upper-cased. */
export function normalizeCode(code: string): string {
  return code.replace(/[\s-]/g, "").toUpperCase();
}

/** Why a host's own code is refused, or null when it's fine. */
export function codeRefusal(code: string): string | null {
  return /^[A-Z0-9]{6,32}$/.test(normalizeCode(code))
    ? null
    : "The access code must be 6 to 32 letters or digits.";
}

/** What the host sees and copies: "482-917" for six digits, else as typed in capitals. */
export function displayCode(code: string): string {
  return /^\d{6}$/.test(code) ? `${code.slice(0, 3)}-${code.slice(3)}` : code;
}
