/**
 * The category registry: one entry per kind of event, holding everything
 * about it (priority, whether it's on by default, the copy, the deep link).
 * Adding an event is one entry here. Pure, so the mobile app can sync it.
 */

import {
  PUSH_CATEGORIES,
  PUSH_TITLE,
  type PushCategory,
  type PushEnvelope,
  type PushEnvelopeV1,
  type PushEvent,
  type PushLevel,
} from "./push-types";
import { safeId, safeKey } from "./redact";

export interface CategoryDef {
  level: PushLevel;
  defaultOn: boolean;
  /** Settings label. */
  label: string;
  /** The one word or phrase shown as the body. Fixed text, no event data. */
  word: string;
  /** App path for an id, or the fallback when the id is missing or unsafe. */
  link: (id: string | null) => string;
}

/** Where a tap goes when nothing more specific is known. */
export const FALLBACK_LINK = "/needs";

export const CATEGORIES: Record<PushCategory, CategoryDef> = {
  asks: {
    level: "time-sensitive",
    defaultOn: true,
    label: "Asks",
    word: "Needs your call",
    link: (id) => (id ? `/orchestrator?workspaceId=${id}` : FALLBACK_LINK),
  },
  "needs-you": {
    level: "active",
    defaultOn: true,
    label: "Waiting for you",
    word: "Needs you",
    link: (id) => (id ? `/session/${id}` : FALLBACK_LINK),
  },
  review: {
    level: "active",
    defaultOn: true,
    label: "Ready for review",
    word: "Ready for review",
    link: (id) => (id ? `/task/${id}` : FALLBACK_LINK),
  },
  ci: {
    level: "active",
    defaultOn: true,
    label: "CI and review problems",
    word: "CI or review failed",
    link: (id) => (id ? `/task/${id}` : FALLBACK_LINK),
  },
  merged: {
    level: "passive",
    defaultOn: false,
    label: "Merged",
    word: "Merged",
    link: (id) => (id ? `/task/${id}` : FALLBACK_LINK),
  },
  agents: {
    level: "active",
    defaultOn: true,
    label: "Messages from agents",
    word: "Agent message",
    link: (id) => (id ? `/session/${id}` : FALLBACK_LINK),
  },
  digest: {
    level: "passive",
    defaultOn: true,
    label: "While you're away",
    word: "Updates",
    link: () => FALLBACK_LINK,
  },
  system: {
    level: "active",
    defaultOn: true,
    label: "Machine alerts",
    word: "Machine alert",
    link: () => "/machines",
  },
};

export const isPushCategory = (c: unknown): c is PushCategory =>
  typeof c === "string" && (PUSH_CATEGORIES as readonly string[]).includes(c);

export function defaultCategories(): PushCategory[] {
  return PUSH_CATEGORIES.filter((c) => CATEGORIES[c].defaultOn);
}

/**
 * The categories a device receives: its saved list, or the defaults when it
 * has none. Unknown names are dropped so an old row survives a removed
 * category.
 */
export function enabledCategories(
  saved: readonly unknown[] | null | undefined
): PushCategory[] {
  return saved
    ? PUSH_CATEGORIES.filter((c) => saved.includes(c))
    : defaultCategories();
}

/**
 * The v1 payload for an event. Built only from the registry and a vetted id
 * and key, so it carries no event text whatever the caller passes.
 */
export function buildPushPayload(event: PushEvent): PushEnvelopeV1 {
  const def = CATEGORIES[event.category];
  const id = safeId(event.id);
  return {
    v: 1,
    c: event.category,
    t: PUSH_TITLE,
    b: def.word,
    l: def.link(id),
    k: safeKey(event.key) ?? `${event.category}:${id ?? "-"}`,
    p: def.level,
  };
}

/**
 * The app side: read what arrived. An unknown version or a malformed body
 * gives the generic fallback, so a newer server never breaks an older app.
 */
export function parsePushEnvelope(raw: unknown): PushEnvelope {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<
    string,
    unknown
  >;
  const category = isPushCategory(o.c) ? o.c : "system";
  if (o.v === 1 || o.v === 2) {
    const link =
      typeof o.l === "string" && isAppLink(o.l)
        ? o.l
        : CATEGORIES[category].link(null);
    const base = {
      c: category,
      t: PUSH_TITLE,
      b: typeof o.b === "string" ? o.b.slice(0, 80) : CATEGORIES[category].word,
      l: link,
      k: safeKey(o.k) ?? `${category}:-`,
      p: CATEGORIES[category].level,
    } as const;
    // A v2 body is read as its generic v1 alert until this app can decrypt.
    return { ...base, v: 1 };
  }
  return buildPushPayload({ category });
}

const APP_PATHS = [
  /^\/needs$/,
  /^\/machines$/,
  /^\/session\/[A-Za-z0-9_-]{1,64}$/,
  /^\/task\/[A-Za-z0-9_-]{1,64}$/,
  /^\/orchestrator\?workspaceId=[A-Za-z0-9_-]{1,64}$/,
];

/** True for a link the registry could have produced. */
export function isAppLink(link: string): boolean {
  return APP_PATHS.some((re) => re.test(link));
}

/**
 * True only for a payload the registry could have built: fixed title, the
 * category's own word, a known link shape, a plain key. A sender checks this
 * before it sends, so nothing else can leave the machine.
 */
export function isGenericPayload(p: unknown): p is PushEnvelopeV1 {
  if (!p || typeof p !== "object") return false;
  const o = p as Record<string, unknown>;
  if (o.v !== 1 || !isPushCategory(o.c)) return false;
  const def = CATEGORIES[o.c];
  return (
    Object.keys(o).sort().join() === "b,c,k,l,p,t,v" &&
    o.t === PUSH_TITLE &&
    o.b === def.word &&
    o.p === def.level &&
    typeof o.l === "string" &&
    isAppLink(o.l) &&
    safeKey(o.k) === o.k
  );
}
