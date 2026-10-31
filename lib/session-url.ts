// Every session has its own address: `/s/<slug>-<id8>`, the slug made from
// its name and id8 the first group of its uuid. Only the id resolves: the
// slug is rebuilt from the current name, so a rename never breaks a link,
// and a stale one is rewritten in place. `/?session=<id>`, the address before,
// still opens and is rewritten the same way. Nothing here grants access; the
// page behind the address is behind the device gate like any other.

import { getAllPaneIds, type PaneState } from "./panes";
import { isUuid, sessionSlug, shortId, SHORT_ID_LEN } from "./session-slug";

export const SESSION_PARAM = "session";
export const SESSION_PATH = "/s/";

// Ids are uuids today; anything id-shaped is accepted so other machines'
// sessions fit too. Everything else in the address is ignored.
const ID_SHAPE = /^[A-Za-z0-9_-]{1,128}$/;
const SHORT = new RegExp(`^[0-9a-f]{${SHORT_ID_LEN}}$`);
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
// The one path segment of `/s/<ref>`.
const REF_PATH = /^\/s\/([A-Za-z0-9-]{1,200})$/;

// The site-relative origin used to parse paths with URL.
const BASE = "http://agentos.invalid";

/** What an address names: a whole id, or a short id and its (cosmetic) slug. */
export type SessionRef =
  { id: string } | { short: string; slug: string | null };

/** A session as links need it: the name only makes the slug. */
export interface SessionLinkable {
  id: string;
  name?: string | null;
}

function refFromSegment(segment: string): SessionRef | null {
  if (isUuid(segment)) return { id: segment.toLowerCase() };
  const lower = segment.toLowerCase();
  const dash = lower.lastIndexOf("-");
  const short = lower.slice(dash + 1);
  if (!SHORT.test(short)) return null;
  const slug = dash > 0 ? lower.slice(0, dash) : null;
  if (slug !== null && !SLUG.test(slug)) return null;
  return { short, slug };
}

export function sessionRefFromHref(href: string): SessionRef | null {
  const url = new URL(href, BASE);
  const m = REF_PATH.exec(url.pathname);
  if (m) return refFromSegment(m[1]);
  const id = url.searchParams.get(SESSION_PARAM);
  return id && ID_SHAPE.test(id) ? { id } : null;
}

/** Whether a ref could name this id (the slug isn't consulted). */
export function refMatches(ref: SessionRef, id: string): boolean {
  if ("id" in ref) return ref.id === id || ref.id === id.toLowerCase();
  return isUuid(id) && id.toLowerCase().startsWith(ref.short);
}

/**
 * The session a ref names among these: the one id, else the one with the
 * prefix, else (two sharing a prefix) the one whose slug matches, then the
 * newest.
 */
export function pickSession<
  T extends { id: string; name: string; created_at?: string | null },
>(ref: SessionRef, sessions: readonly T[]): T | null {
  const found = sessions.filter((s) => refMatches(ref, s.id));
  if (found.length <= 1) return found[0] ?? null;
  if ("short" in ref && ref.slug) {
    const bySlug = found.filter((s) => sessionSlug(s.name) === ref.slug);
    if (bySlug.length === 1) return bySlug[0];
    if (bySlug.length > 1) return newest(bySlug);
  }
  return newest(found);
}

const newest = <T extends { created_at?: string | null }>(xs: T[]): T =>
  xs.reduce((a, b) => ((b.created_at ?? "") > (a.created_at ?? "") ? b : a));

/**
 * A session's address: `/s/<slug>-<id8>`, or `/s/<id8>` when the name isn't
 * at hand (opening it fills the slug in). An id that isn't a uuid keeps the
 * old `/?session=<id>`.
 */
export function sessionPath(s: SessionLinkable): string {
  if (!isUuid(s.id)) return `/?${SESSION_PARAM}=${encodeURIComponent(s.id)}`;
  const short = shortId(s.id);
  return s.name == null
    ? `${SESSION_PATH}${short}`
    : `${SESSION_PATH}${sessionSlug(s.name)}-${short}`;
}

/** The address a ref names as it stands, slug and all. */
export function refPath(ref: SessionRef): string {
  if ("id" in ref) return sessionPath({ id: ref.id });
  const slug = ref.slug ? `${ref.slug}-` : "";
  return `${SESSION_PATH}${slug}${ref.short}`;
}

function hrefWithPath(href: string, path: string | null): string {
  const url = new URL(href, BASE);
  url.searchParams.delete(SESSION_PARAM);
  const target = new URL(path ?? "/", BASE);
  url.pathname = target.pathname;
  target.searchParams.forEach((v, k) => url.searchParams.set(k, v));
  return url.pathname + url.search + url.hash;
}

/**
 * The same address showing this session (or none), as path+query+hash. Every
 * other query param (`?settings=`, `?welcome=`) stays.
 */
export function hrefWithSession(
  href: string,
  s: SessionLinkable | null
): string {
  return hrefWithPath(href, s ? sessionPath(s) : null);
}

/** The same address showing the session a ref names. */
export function hrefWithRef(href: string, ref: SessionRef): string {
  return hrefWithPath(href, refPath(ref));
}

/** The session a link to this same instance opens, or null for any other link. */
export function inAppSessionRef(
  href: string,
  origin: string
): SessionRef | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  if (url.origin !== origin) return null;
  if (url.pathname !== "/" && !url.pathname.startsWith(SESSION_PATH))
    return null;
  return sessionRefFromHref(href);
}

export function sessionLink(origin: string, s: SessionLinkable): string {
  return `${origin}${sessionPath(s)}`;
}

/**
 * The address to come back to after pairing, or null. Only the app's own
 * page survives: `/` with a query, or a session's `/s/<ref>`. Checked after
 * parsing, as `/.//host` and the like resolve to another host.
 */
export function safeNextPath(raw: string | null | undefined): string | null {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return null;
  let url: URL;
  try {
    url = new URL(raw, BASE);
  } catch {
    return null;
  }
  if (url.origin !== BASE) return null;
  if (REF_PATH.test(url.pathname)) return url.pathname + url.search;
  if (url.pathname !== "/" || !url.search) return null;
  return "/" + url.search;
}

/** Where the gate sends a page request it refuses: /pair, keeping the way back. */
export function pairLocation(requestUrl: string | undefined): string {
  const next = safeNextPath(requestUrl);
  return next ? `/pair?next=${encodeURIComponent(next)}` : "/pair";
}

/**
 * Where a session is already showing: a tab in one of `paneIds` (every pane
 * by default), preferring a pane where it is the active tab.
 */
export function locateSession(
  state: PaneState,
  sessionId: string,
  paneIds: string[] = getAllPaneIds(state.layout)
): { paneId: string; tabId: string } | null {
  let fallback: { paneId: string; tabId: string } | null = null;
  for (const paneId of paneIds) {
    const pane = state.panes[paneId];
    if (!pane) continue;
    for (const tab of pane.tabs) {
      if (tab.sessionId !== sessionId) continue;
      if (tab.id === pane.activeTabId) return { paneId, tabId: tab.id };
      fallback ??= { paneId, tabId: tab.id };
    }
  }
  return fallback;
}

export interface SessionUrlEnv {
  href(): string;
  // The session the address names goes along, for the entry's own record.
  push(href: string, sessionId: string | null): void;
  replace(href: string, sessionId: string | null): void;
  /** The address already says it: the entry still learns which session. */
  settle?(sessionId: string | null): void;
}

export interface SessionUrlDeps {
  /** The listed session a ref names, or null. */
  find(ref: SessionRef): string | null;
  /** A listed session's current name, for its address. */
  nameOf(id: string): string | null;
  /** Show a listed session. */
  open(id: string): void;
  /**
   * Refetch the list once, for a session made a moment ago; true when it was
   * found and opened. Archived, merged and dropped sessions aren't listed and
   * stay not found.
   */
  openUnlisted(ref: SessionRef): Promise<boolean>;
  /** The address named a session that can't be opened. */
  notFound(ref: SessionRef): void;
}

/**
 * Keeps the address bar and the focused session in step. The page reports
 * what's focused; the address follows. The address, on load or on
 * back/forward, opens a session; nothing else does.
 *
 * A switch away from a live session pushes an entry, so back returns to it.
 * Anything else replaces: the first sync, leaving a session that was archived
 * or deleted, leaving a sessionless address, and rewriting an address that
 * names the shown session another way (an old `?session=`, a stale slug, a
 * rename).
 */
export class SessionUrlSync {
  private started = false;
  // A session the address asked for, until it's the one focused (or the
  // open plainly didn't land).
  private pending: SessionRef | null = null;
  private pendingUntil = 0;
  private focused: string | null = null;

  constructor(
    private env: SessionUrlEnv,
    private deps: SessionUrlDeps,
    private now: () => number = Date.now
  ) {}

  /** Once panes and sessions are loaded: follow the address it opened with. */
  async start(): Promise<void> {
    if (this.started) return;
    const ref = sessionRefFromHref(this.env.href());
    if (ref) await this.go(ref);
    this.started = true;
    if (!this.pending) this.sync();
  }

  /** The focused tab's session, or null when it shows none. */
  focusChanged(id: string | null): void {
    this.focused = id;
    if (this.pending && this.now() < this.pendingUntil) {
      if (!id || !refMatches(this.pending, id)) return;
    }
    this.pending = null;
    if (this.started) this.sync();
  }

  /** The focused session's name changed: the address takes the new slug. */
  renamed(): void {
    if (this.started && !this.pending) this.write("replace");
  }

  /** Back or forward landed on another entry. */
  async popstate(): Promise<void> {
    if (!this.started) return;
    const ref = sessionRefFromHref(this.env.href());
    if (ref) {
      const id = this.deps.find(ref);
      if (!id || id !== this.focused) await this.go(ref);
    }
    // An entry with no session, or one that couldn't open: say what's shown.
    if (!this.pending) this.write("replace");
  }

  private async go(ref: SessionRef): Promise<void> {
    const id = this.deps.find(ref);
    if (id && id === this.focused) return;
    this.pending = ref;
    this.pendingUntil = this.now() + PENDING_MS;
    if (id) return this.deps.open(id);
    const opened = await this.deps.openUnlisted(ref).catch(() => false);
    if (opened) return;
    if (this.pending === ref) this.pending = null;
    this.deps.notFound(ref);
  }

  private sync(): void {
    const ref = sessionRefFromHref(this.env.href());
    const current = ref && this.deps.find(ref);
    this.write(current && current !== this.focused ? "push" : "replace");
  }

  private write(mode: "push" | "replace"): void {
    const href = this.env.href();
    const id = this.focused;
    const next = hrefWithSession(
      href,
      id ? { id, name: this.deps.nameOf(id) ?? undefined } : null
    );
    const url = new URL(href, BASE);
    if (next === url.pathname + url.search + url.hash) {
      this.env.settle?.(id);
      return;
    }
    if (mode === "push") this.env.push(next, id);
    else this.env.replace(next, id);
  }
}

// How long an open the address asked for may take to show before the page's
// own focus wins again.
const PENDING_MS = 5000;
