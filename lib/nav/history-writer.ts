import type { Position } from "./position";

/**
 * The one place the page writes browser history. A chat switch or a bookmark
 * pushes an entry; where the reader is in the chat goes into the CURRENT
 * entry's state with replaceState, at most once per POSITION_EVERY_MS, so
 * back lands on the message that was on screen without filling the history
 * (Safari throws after 100 calls in 30 seconds, Firefox throws on a burst,
 * Chrome drops them silently).
 *
 * Next patches pushState/replaceState to carry its own keys in the state it
 * is given, so the state is always the current one with `aos` replaced.
 */
export interface NavState {
  v: 1;
  /** Counts up with every push; the menu's key for the entry. */
  index: number;
  sessionId: string | null;
  pos?: Position;
}

export interface HistoryLike {
  state: unknown;
  pushState(state: unknown, unused: string, url?: string): void;
  replaceState(state: unknown, unused: string, url?: string): void;
}

export const POSITION_EVERY_MS = 2000;
// Position writes stop, navigation never does, when a burst gets this close
// to the limits above.
const BURST_WINDOW_MS = 30_000;
const BURST_MAX = 50;

export function navStateOf(state: unknown): NavState | null {
  const aos = (state as { aos?: NavState } | null)?.aos;
  return aos && aos.v === 1 && typeof aos.index === "number" ? aos : null;
}

const withNav = (state: unknown, aos: NavState) => ({
  ...(state && typeof state === "object" ? state : {}),
  aos,
});

export class HistoryWriter {
  private pending: { sessionId: string; pos: Position } | null = null;
  private lastWrite = -Infinity;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private writes: number[] = [];

  constructor(private h: HistoryLike) {}

  /** The state of the entry the page is on. */
  current(): NavState | null {
    return navStateOf(this.h.state);
  }

  /** Where the reader is now; written into the current entry, coalesced. */
  setPosition(sessionId: string, pos: Position): void {
    this.pending = { sessionId, pos };
    if (this.timer) return;
    const wait = this.lastWrite + POSITION_EVERY_MS - Date.now();
    if (wait <= 0) this.flush();
    else this.timer = setTimeout(() => this.flush(), wait);
  }

  /** Writes the waiting position now, if it belongs to the current entry. */
  flush(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const p = this.pending;
    this.pending = null;
    const cur = this.current();
    if (!p || !cur || cur.sessionId !== p.sessionId) return;
    const now = Date.now();
    this.writes = this.writes.filter((t) => now - t < BURST_WINDOW_MS);
    if (this.writes.length >= BURST_MAX) return;
    this.writes.push(now);
    this.lastWrite = now;
    this.h.replaceState(withNav(this.h.state, { ...cur, pos: p.pos }), "");
  }

  /** A new entry for a chat. The one being left keeps its position first. */
  push(href: string, sessionId: string | null): NavState {
    this.flush();
    const cur = this.current();
    const next: NavState = {
      v: 1,
      index: (cur?.index ?? 0) + 1,
      sessionId,
    };
    this.h.pushState(withNav(null, next), "", href);
    return next;
  }

  /** The same entry at another address (a rename), keeping its state. A page
   * that has none yet gets its first, index 0. */
  replace(href: string, sessionId: string | null): NavState {
    const cur = this.current();
    const next: NavState = cur
      ? { ...cur, sessionId }
      : { v: 1, index: 0, sessionId };
    // A different chat takes the entry over: its position was another's.
    if (cur && cur.sessionId !== sessionId) delete next.pos;
    if (this.pending && this.pending.sessionId !== sessionId)
      this.pending = null;
    this.h.replaceState(withNav(this.h.state, next), "", href);
    return next;
  }
}
