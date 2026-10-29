/**
 * Generic credential shapes for redactForShare: key/value secrets in any
 * syntax, Basic auth headers, mysql -p, and high-entropy tokens. Pure data
 * and predicates; redact.ts applies them and counts the hits.
 */

const WORDS =
  "password|passwd|pwd|secret|token|api[_-]?key|apikey|access[_-]?key|client[_-]?secret|auth|private[_-]?key";

// A value that is a type, a placeholder or a call, not a credential.
const NOT_A_VALUE =
  "(?![\"']?\\[secret\\])" +
  "(?!(?:string|number|boolean|any|unknown|null|undefined|true|false|none|void|required|optional)\\b)" +
  "(?![$<{(\\[%]|\\.\\.\\.)(?![\\w.]+\\()";

/**
 * `password=x`, `"api_key": "x"`, `token: x`, `export DB_PASSWORD=x`,
 * `--password=x`. The key may carry any prefix (GITHUB_TOKEN) but must end
 * in the word, so `author` and `max_tokens` stay. Group 1 is kept.
 */
export const KEY_VALUE = new RegExp(
  `((?<![\\w.-])[\\w.-]*(?:${WORDS})["']?[ \\t]*[:=][ \\t]*)` +
    `${NOT_A_VALUE}("[^"\\n]*"|'[^'\\n]*'|[^\\s,;'"&}\\])]+)`,
  "gi"
);

/** `--password value`, `--api-key value` (space separated). */
export const CLI_FLAG = new RegExp(
  `(--[\\w-]*?(?:${WORDS})[ \\t]+)(?!-)${NOT_A_VALUE}("[^"\\n]*"|'[^'\\n]*'|\\S+)`,
  "gi"
);

/**
 * mysql-family `-pSECRET` (attached: `-p secret` would be a database name).
 * psql's -p is a port, so it is left alone.
 */
export const MYSQL_P =
  /(\b(?:mysql|mysqldump|mysqladmin|mariadb)\b[^\n|;&]*?\s-p)(?=\S)(\S+)/gi;

/** `Authorization: Basic <x>` (Bearer is handled in redact.ts). */
export const BASIC_AUTH =
  /(\bauthorization["']?\s*[:=]\s*["']?basic\s+)[A-Za-z0-9+/=._~-]{4,}/gi;

/** A base64 data URI, such as an inline image. Kept as is: not a credential. */
export const DATA_URI =
  /data:[\w.+-]+\/[\w.+-]+(?:;[\w=.-]+)*;base64,[A-Za-z0-9+/=_-]+/g;

/** Candidate runs for the entropy test. */
export const TOKEN_RUN = /(?<![A-Za-z0-9_\-+/=])[A-Za-z0-9_\-+/=]{32,}/g;

export const ENTROPY_MIN = 4.0;

export function shannon(s: string): number {
  const counts = new Map<string, number>();
  for (const c of s) counts.set(c, (counts.get(c) ?? 0) + 1);
  let h = 0;
  for (const n of counts.values())
    h -= (n / s.length) * Math.log2(n / s.length);
  return h;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function looksLikePath(s: string): boolean {
  if (/^(?:\.{0,2}\/|~\/)/.test(s)) return true;
  const parts = s.split("/");
  return parts.length > 2 && parts.every((p) => p.length >= 2);
}

/** True when a run is a random-looking token rather than prose, a hash or a path. */
export function isHighEntropyToken(s: string): boolean {
  if (/^[0-9a-f]+$/i.test(s) && s.length <= 64) return false; // git sha, md5/sha256
  if (UUID.test(s)) return false;
  if (looksLikePath(s)) return false;
  if (!/[a-z]/.test(s) || !/[A-Z]/.test(s) || !/[0-9]/.test(s)) return false;
  return shannon(s) > ENTROPY_MIN;
}
