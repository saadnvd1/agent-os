// Every session has its own address: `/?session=<id>`. The id, not the name:
// names change, ids don't. Nothing here grants access; the page behind the
// address is behind the device gate like any other.

import { getAllPaneIds, type PaneState } from "./panes";

export const SESSION_PARAM = "session";

// Ids are uuids today; anything id-shaped is accepted so other machines'
// sessions fit too. Everything else in the address is ignored.
const ID_SHAPE = /^[A-Za-z0-9_-]{1,128}$/;

// The site-relative origin used to parse paths with URL.
const BASE = "http://agentos.invalid";

export function sessionIdFromHref(href: string): string | null {
  const id = new URL(href, BASE).searchParams.get(SESSION_PARAM);
  return id && ID_SHAPE.test(id) ? id : null;
}

/** The same address with the session set (or removed), as path+query+hash. */
export function hrefWithSession(href: string, id: string | null): string {
  const url = new URL(href, BASE);
  if (id) url.searchParams.set(SESSION_PARAM, id);
  else url.searchParams.delete(SESSION_PARAM);
  return url.pathname + url.search + url.hash;
}

export function sessionLink(origin: string, id: string): string {
  return `${origin}/?${SESSION_PARAM}=${encodeURIComponent(id)}`;
}

/**
 * The address to come back to after pairing, or null. Only the app's own
 * page with a query survives: what a link to a session is. Checked after
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
  if (url.origin !== BASE || url.pathname !== "/" || !url.search) return null;
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
  push(href: string): void;
  replace(href: string): void;
}

export interface SessionUrlDeps {
  /** A session the sidebar lists. */
  isKnown(id: string): boolean;
  /** Show a listed session. */
  open(id: string): void;
  /**
   * Refetch the list once, for a session made a moment ago; true when it was
   * found and opened. Archived, merged and dropped sessions aren't listed and
   * stay not found.
   */
  openUnlisted(id: string): Promise<boolean>;
  /** The address named a session that can't be opened. */
  notFound(id: string): void;
}

/**
 * Keeps the address bar and the focused session in step. The page reports
 * what's focused; the address follows. The address, on load or on
 * back/forward, opens a session; nothing else does.
 *
 * A switch away from a live session pushes an entry, so back returns to it.
 * Anything else replaces: the first sync, leaving a session that was archived
 * or deleted, and leaving a sessionless address.
 */
export class SessionUrlSync {
  private started = false;
  // A session the address asked for, until it's the one focused (or the
  // open plainly didn't land).
  private pending: string | null = null;
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
    const id = sessionIdFromHref(this.env.href());
    if (id) await this.go(id);
    this.started = true;
    if (!this.pending) this.sync();
  }

  /** The focused tab's session, or null when it shows none. */
  focusChanged(id: string | null): void {
    this.focused = id;
    if (this.pending && this.now() < this.pendingUntil) {
      if (id !== this.pending) return;
    }
    this.pending = null;
    if (this.started) this.sync();
  }

  /** Back or forward landed on another entry. */
  async popstate(): Promise<void> {
    if (!this.started) return;
    const id = sessionIdFromHref(this.env.href());
    if (id && id !== this.focused) await this.go(id);
    // An entry with no session, or one that couldn't open: say what's shown.
    if (!this.pending) this.write("replace");
  }

  private async go(id: string): Promise<void> {
    if (id === this.focused) return;
    this.pending = id;
    this.pendingUntil = this.now() + PENDING_MS;
    if (this.deps.isKnown(id)) return this.deps.open(id);
    const opened = await this.deps.openUnlisted(id).catch(() => false);
    if (opened) return;
    if (this.pending === id) this.pending = null;
    this.deps.notFound(id);
  }

  private sync(): void {
    const current = sessionIdFromHref(this.env.href());
    if (current === this.focused) return;
    this.write(current && this.deps.isKnown(current) ? "push" : "replace");
  }

  private write(mode: "push" | "replace"): void {
    const href = this.env.href();
    if (sessionIdFromHref(href) === this.focused) return;
    const next = hrefWithSession(href, this.focused);
    if (mode === "push") this.env.push(next);
    else this.env.replace(next);
  }
}

// How long an open the address asked for may take to show before the page's
// own focus wins again.
const PENDING_MS = 5000;
