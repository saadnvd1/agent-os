/**
 * What a shared snapshot must not carry: credentials, the machine's paths,
 * addresses and names, and email addresses. Pure: everything about this
 * machine comes in through the context (lib/share/context), so the rules can
 * be tested with invented values.
 *
 * Public hostnames (github.com) are left alone on purpose: masking every
 * domain would destroy ordinary content. Only names that identify the
 * reader's own machines and network are masked.
 */

import {
  PRIVATE_KEY_BLOCK,
  SECRET_ASSIGNMENT,
  SECRET_PARAM,
  SECRET_TOKENS,
  URL_USERINFO,
  BASE64_RUN,
  looksRandom,
} from "@/lib/orchestrator/untrusted";
import { HOME } from "@/lib/session-audit/normalize";

export type Kind = "secret" | "path" | "ip" | "host" | "email";
export type Hits = Record<Kind, number>;
export const noHits = (): Hits => ({
  secret: 0,
  path: 0,
  ip: 0,
  host: 0,
  email: 0,
});
export const addHits = (a: Hits, b: Hits): Hits => ({
  secret: a.secret + b.secret,
  path: a.path + b.path,
  ip: a.ip + b.ip,
  host: a.host + b.host,
  email: a.email + b.email,
});

export interface ShareContext {
  /** The user's home directory. */
  home: string;
  /** The OS account name. */
  user: string;
  /** Values of secret-looking environment variables, masked wherever they appear. */
  secrets: string[];
  /** This machine's names, and the hosts its ssh config knows. */
  hosts: string[];
}

export const NO_CONTEXT: ShareContext = {
  home: "",
  user: "",
  secrets: [],
  hosts: [],
};

const SECRET = "[secret]";
const BEARER = /(\bbearer\s+)(?!\[secret\])[A-Za-z0-9._~+/=-]{8,}/gi;
const INLINE_ASSIGNMENT =
  /(\b[A-Z][A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|PASS|PWD|CREDENTIALS?|AUTH)[A-Z0-9_]*=)(?!\[secret\])[^\s'"]+/g;
const LONG_HEX = /\b[a-fA-F0-9]{40,}\b/g;

const IPV4 =
  /(?<![\w.])(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)(?![\w.]*\w)/g;
const KEEP_IPV4 = new Set(["127.0.0.1", "0.0.0.0"]);
const G = "[0-9a-f]{1,4}";
// Eight groups, or a "::" compression; a lone "12:30:45" is a time, not this.
const IPV6 = new RegExp(
  `(?<![\\w:])(?:(?:${G}:){7}${G}|(?:${G}:){1,7}:(?:${G}(?::${G}){0,6})?|::(?:${G}(?::${G}){0,6})?)(?![\\w:])`,
  "gi"
);
const KEEP_IPV6 = new Set(["::1", "::"]);

const LOCAL_HOST =
  /\b(?:[a-z0-9][a-z0-9-]*\.)+(?:ts\.net|local|lan|internal|home\.arpa)\b/gi;
const CONNECT_HOST = /\bm-[0-9a-f]{16}\.runagentos\.com\b/gi;
const EMAIL = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+\b/g;

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A replacement that counts what it replaced. */
function sub(
  text: string,
  re: RegExp,
  to: string | ((m: string, ...g: string[]) => string),
  hits: Hits,
  kind: Kind,
  keep?: (m: string) => boolean
): string {
  return text.replace(re, (m: string, ...g: string[]) => {
    if (keep?.(m)) return m;
    hits[kind]++;
    return typeof to === "function" ? to(m, ...g) : to;
  });
}

export function redactForShare(
  input: string,
  ctx: ShareContext = NO_CONTEXT,
  opts: { only?: Kind[] } = {}
): { text: string; hits: Hits } {
  const hits = noHits();
  let t = input;
  const on = (k: Kind) => !opts.only || opts.only.includes(k);

  // 1. Credentials by shape.
  t = sub(t, PRIVATE_KEY_BLOCK, SECRET, hits, "secret");
  t = sub(
    t,
    SECRET_ASSIGNMENT,
    (_m, k) => `${k}${SECRET}`,
    hits,
    "secret",
    (m) => m.endsWith(SECRET)
  );
  t = sub(t, INLINE_ASSIGNMENT, (_m, k) => `${k}${SECRET}`, hits, "secret");
  t = sub(t, BEARER, (_m, k) => `${k}${SECRET}`, hits, "secret");
  t = sub(
    t,
    URL_USERINFO,
    (_m, s) => `${s}${SECRET}@`,
    hits,
    "secret",
    (m) => m.endsWith(`${SECRET}@`)
  );
  t = sub(
    t,
    SECRET_PARAM,
    (_m, k) => `${k}${SECRET}`,
    hits,
    "secret",
    (m) => m.endsWith(SECRET)
  );
  for (const re of SECRET_TOKENS) t = sub(t, re, SECRET, hits, "secret");
  t = sub(t, LONG_HEX, SECRET, hits, "secret");
  t = sub(t, BASE64_RUN, SECRET, hits, "secret", (m) => !looksRandom(m));

  // 2. This machine's own secrets, wherever they appear.
  for (const value of ctx.secrets) {
    if (value.length < 8 || !t.includes(value)) continue;
    const parts = t.split(value);
    hits.secret += parts.length - 1;
    t = parts.join(SECRET);
  }

  // 3. Home paths, and the account name before an @.
  if (on("path") && ctx.home.length > 1)
    t = sub(
      t,
      new RegExp(escape(ctx.home) + "(?![\\w.-])", "g"),
      "~",
      hits,
      "path"
    );
  if (on("path")) t = sub(t, new RegExp(HOME.source, "g"), "~", hits, "path");
  if (on("path") && ctx.user.length > 2)
    t = sub(
      t,
      new RegExp(`\\b${escape(ctx.user)}(?=@)`, "g"),
      "user",
      hits,
      "path"
    );

  // 4. Addresses.
  if (on("ip")) {
    t = sub(t, IPV4, "[ip]", hits, "ip", (m) => KEEP_IPV4.has(m));
    t = sub(t, IPV6, "[ip]", hits, "ip", (m) => KEEP_IPV6.has(m));
  }

  // 5. This machine's names, and private-network suffixes.
  const names = [...new Set(ctx.hosts.filter((h) => h.length > 2))].sort(
    (a, b) => b.length - a.length
  );
  if (on("host") && names.length)
    t = sub(
      t,
      new RegExp(
        `(?<![\\w.-])(?:${names.map(escape).join("|")})(?![\\w-])`,
        "gi"
      ),
      "[host]",
      hits,
      "host"
    );
  if (on("host")) {
    t = sub(t, CONNECT_HOST, "[host]", hits, "host");
    t = sub(t, LOCAL_HOST, "[host]", hits, "host");
  }

  // 6. Email addresses.
  if (on("email")) t = sub(t, EMAIL, "[email]", hits, "email");

  return { text: t, hits };
}
