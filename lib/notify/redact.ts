/**
 * Keeps free text and secret-looking strings out of push payloads. Pure, so
 * the mobile app can sync it.
 */

const MAX_ID = 64;
const SAFE_ID = /^[A-Za-z0-9_-]+$/;

/** Hex or base64 runs this long are treated as keys. */
const LONG_RUN = /[A-Za-z0-9+/_=-]{24,}/g;
const SECRET_PATTERNS: RegExp[] = [
  /\baosd_[A-Za-z0-9_-]+/g,
  /\bsk-[A-Za-z0-9_-]{8,}/g,
  /\bgh[pousr]_[A-Za-z0-9]{8,}/g,
  /\bAKIA[0-9A-Z]{8,}/g,
  /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/g,
];

/** True when the string looks like a token, key or JWT. */
export function looksSecret(text: string): boolean {
  return [...SECRET_PATTERNS, LONG_RUN].some((re) => {
    re.lastIndex = 0;
    return re.test(text);
  });
}

/**
 * First line only, collapsed whitespace, no backticks, secrets replaced by
 * `…`, clipped. For the rich text of a later envelope version.
 */
export function scrubText(text: string | null | undefined, max = 120): string {
  let s = (text ?? "").split(/\r?\n/).find((l) => l.trim()) ?? "";
  s = s.replace(/`+/g, "");
  for (const re of SECRET_PATTERNS) s = s.replace(re, "…");
  s = s.replace(LONG_RUN, "…");
  s = s.replace(/\s+/g, " ").trim();
  return s.length > max ? s.slice(0, max - 1).trimEnd() + "…" : s;
}

/** An id fit for a link or key: short and plain. Null if it isn't. */
export function safeId(id: unknown): string | null {
  if (typeof id !== "string" || id.length === 0 || id.length > MAX_ID)
    return null;
  if (!SAFE_ID.test(id)) return null;
  return looksSecret(id) ? null : id;
}

/**
 * A collapse key: opaque and bounded. Anything with characters outside the
 * plain set, or secret-looking, is dropped rather than cleaned.
 */
export function safeKey(key: unknown): string | null {
  if (typeof key !== "string" || key.length === 0 || key.length > 128)
    return null;
  if (!/^[A-Za-z0-9_:.-]+$/.test(key)) return null;
  return looksSecret(key) ? null : key;
}
