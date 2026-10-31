import { proxy } from "valtio";
import { HistoryWriter, navStateOf } from "@/lib/nav/history-writer";
import {
  emptyMirror,
  moveTo,
  renameIn,
  visit,
  type Mirror,
} from "@/lib/nav/history-mirror";
import type { Position } from "@/lib/nav/position";

const KEY = "agentos-nav-history";

function load(): Mirror {
  try {
    const raw = JSON.parse(sessionStorage.getItem(KEY) ?? "null");
    if (raw && Array.isArray(raw.entries) && typeof raw.current === "number")
      return raw;
  } catch {
    // Unavailable or corrupt: start over.
  }
  return emptyMirror();
}

const noHistory = typeof window === "undefined";
// Made on first use in the browser.
let writer: HistoryWriter | null = null;
const w = () => (writer ??= new HistoryWriter(window.history));

// The entries this tab made, for the back button's menu and for knowing
// whether there is anywhere to go. Kept in sessionStorage across a reload.
export const navHistory = proxy<Mirror>(noHistory ? emptyMirror() : load());

function set(next: Mirror) {
  navHistory.entries = next.entries;
  navHistory.current = next.current;
  try {
    sessionStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // The menu is lost on reload; history itself is not.
  }
}

const snapshot = (): Mirror => ({
  entries: navHistory.entries.map((e) => ({ ...e })),
  current: navHistory.current,
});

export const navHistoryActions = {
  /** A new entry for a chat switch or a bookmark. */
  push: (href: string, sessionId: string | null, name: string) => {
    const s = w().push(href, sessionId);
    set(
      visit(
        snapshot(),
        { index: s.index, sessionId: sessionId ?? "", name },
        "push"
      )
    );
  },
  /** The same entry at another address, or the first sight of this one. */
  replace: (href: string, sessionId: string | null, name: string) => {
    const s = w().replace(href, sessionId);
    set(
      visit(
        snapshot(),
        { index: s.index, sessionId: sessionId ?? "", name },
        "replace"
      )
    );
  },
  /** Where the reader is in the chat, for the entry they're on. */
  setPosition: (sessionId: string, pos: Position) =>
    w().setPosition(sessionId, pos),
  flush: () => w().flush(),
  /** Back or forward landed on an entry: where it was made, if known. */
  popped: () => {
    const s = w().current();
    if (s) set(moveTo(snapshot(), s.index));
    return s;
  },
  rename: (sessionId: string, name: string) =>
    set(renameIn(snapshot(), sessionId, name)),
  back: () => {
    w().flush();
    window.history.back();
  },
  forward: () => {
    w().flush();
    window.history.forward();
  },
  /** The menu's pick: any entry, by index. */
  goTo: (index: number) => {
    w().flush();
    window.history.go(index - navHistory.current);
  },
  currentState: () => (noHistory ? null : navStateOf(window.history.state)),
};
