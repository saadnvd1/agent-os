"use client";

import {
  type RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ChatItem } from "@/lib/chat/events";
import {
  flattenHits,
  joinPage,
  locate,
  MIN_QUERY,
  stepIndex,
  nextHits,
  type FindResults as Results,
  type FindTarget,
  type SearchResult,
} from "@/lib/chat/find";
import { findRanges, paint, unpaint } from "./find-highlight";
import type { RowStore } from "./rowState";

// Asks the chat showing a session to open its find bar (the phone's header).
export const FIND_EVENT = "agentos:find-in-chat";
export const openFind = (sessionId: string) =>
  window.dispatchEvent(new CustomEvent(FIND_EVENT, { detail: sessionId }));

// ⌘F on a Mac, Ctrl+F elsewhere.
export function isFindKey(e: {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}): boolean {
  const mac =
    typeof navigator !== "undefined" &&
    /Mac|iPhone|iPad/.test(navigator.platform);
  const mod = mac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
  return mod && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "f";
}

// How long to wait for a match's row to render (and a tool's output to load).
const SETTLE_MS = 2000;
// How long a placed match is held in view while the list settles around it
// (rows measured, older pages landing), unless the reader scrolls first.
const HOLD_MS = 800;
const DEBOUNCE_MS = 150;

// A match being shown, and the block it was found in.
type Pinned = FindTarget & { block: string };

export type FindStatus = "idle" | "searching" | "done" | "unavailable";

export interface FindDeps {
  // The orchestrator's chat folds events into rows that find has to open.
  foldEvents?: boolean;
  search: (query: string, before?: number) => Promise<SearchResult | null>;
  items: ChatItem[];
  hasMore: boolean;
  loadingOlder: boolean;
  loadOlder: () => void;
  rows: RowStore;
  // Scrolls the list to a timeline block, and its scroll container.
  scrollToBlock: (block: string) => Promise<void>;
  scroller: () => HTMLElement | null;
  // Stops following the end of the conversation.
  release: () => void;
}

const blockEl = (root: HTMLElement, block: string) =>
  root.querySelector<HTMLElement>(`[data-block="${CSS.escape(block)}"]`);

// The element showing an item: its own row inside a block, or the block.
function itemEl(root: HTMLElement, block: string, id: string) {
  const b = blockEl(root, block);
  return b?.querySelector<HTMLElement>(`[data-item="${CSS.escape(id)}"]`) ?? b;
}

// Scrolls `root` so `rect` sits a third of the way down, if it's out of view.
function bringIntoView(root: HTMLElement, rect: DOMRect) {
  const box = root.getBoundingClientRect();
  if (rect.top >= box.top + 8 && rect.bottom <= box.bottom - 8) return;
  root.scrollTop += rect.top - box.top - box.height / 3;
}

/**
 * Find in a conversation: searches the stored conversation on the server,
 * walks its results newest first, and brings each one on screen (loading
 * older pages, opening folded rows) with its text highlighted.
 */
export function useFind(deps: FindDeps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Results | null>(null);
  const [index, setIndex] = useState(0);
  const [status, setStatus] = useState<FindStatus>("idle");
  const d = useRef(deps);
  useEffect(() => {
    d.current = deps;
  });

  // Each search answers only if it's still the latest one asked.
  const asked = useRef(0);
  useEffect(() => {
    const q = query.trim();
    const id = ++asked.current;
    if (!open || q.length < MIN_QUERY) {
      setResults(null);
      setStatus("idle");
      return;
    }
    setStatus("searching");
    const timer = setTimeout(async () => {
      const search = d.current.search;
      const first = await search(q);
      const more =
        first && !first.hits.length && first.hasMore
          ? await nextHits(search, q, first.cursor)
          : null;
      if (id !== asked.current) return;
      setStatus(first ? "done" : "unavailable");
      const r = first && { query: q, ...first };
      setResults(r && more ? joinPage(r, more) : r);
      setIndex(0);
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [open, query]);

  const targets = useMemo(
    () => (results ? flattenHits(results.hits) : []),
    [results]
  );
  const target: FindTarget | undefined = targets[index];

  const go = useCallback(
    async (dir: 1 | -1) => {
      const r = results;
      if (!r || !targets.length) return;
      const next = stepIndex(index, dir, targets.length, r.hasMore);
      if (next !== "more") return setIndex(next);
      const id = asked.current;
      const page = await nextHits(d.current.search, r.query, r.cursor);
      if (id !== asked.current || !page) return;
      setResults(joinPage(r, page));
      setIndex(page.hits.length ? targets.length : 0);
    },
    [results, targets, index]
  );

  // Going to a match: older pages load until it's there, then its rows open
  // and it scrolls into view. Once per match, so new output arriving doesn't
  // pull the reader back to it.
  const shown = useRef<FindTarget | null>(null);
  const [pinned, setPinned] = useState<Pinned | null>(null);
  const { items, hasMore, loadingOlder, foldEvents } = deps;
  useEffect(() => {
    if (!open || !target || shown.current === target) return;
    const { loadOlder, rows, release, scrollToBlock } = d.current;
    const where = locate(items, target.id, { foldEvents });
    if (!where) {
      if (!hasMore) shown.current = target;
      else if (!loadingOlder) loadOlder();
      return;
    }
    shown.current = target;
    for (const key of where.open) rows.set(key, true);
    release();
    const pin = () =>
      shown.current === target && setPinned({ ...target, block: where.block });
    scrollToBlock(where.block).then(pin, pin);
  }, [open, target, items, hasMore, loadingOlder, foldEvents]);

  // Paints every match on screen, and the current one apart; the current one
  // is scrolled to once its row (and a tool's loaded output) shows it.
  const [owner] = useState(() => ({}));
  useEffect(() => {
    const root = d.current.scroller();
    const q = results?.query;
    if (!open || !root || !q) return unpaint(owner);
    const current = pinned;
    let frame = 0;
    let placedAt = current ? 0 : -1;
    let near = false;
    let moved = false;
    const started = Date.now();
    const holding = () =>
      placedAt > 0 && !moved && Date.now() - placedAt < HOLD_MS;
    const draw = () => {
      frame = 0;
      const all = findRanges(root, q);
      let mark: Range | null = null;
      const el = current && itemEl(root, current.block, current.id);
      if (el) {
        const own = findRanges(el, q);
        const exact = own.length > current.n;
        mark = own[Math.min(current.n, own.length - 1)] ?? null;
        if (!placedAt && (exact || Date.now() - started > SETTLE_MS)) {
          bringIntoView(root, (mark ?? el).getBoundingClientRect());
          placedAt = Date.now();
        } else if (holding()) {
          bringIntoView(root, (mark ?? el).getBoundingClientRect());
        } else if (!placedAt && !near) {
          // Its row is here and the rest is loading (a tool's output).
          bringIntoView(root, el.getBoundingClientRect());
          near = true;
        }
      }
      paint(owner, all, mark);
      if ((!placedAt && Date.now() - started < SETTLE_MS * 2) || holding())
        schedule();
    };
    const schedule = () => {
      frame ||= requestAnimationFrame(draw);
    };
    const watch = new MutationObserver(schedule);
    watch.observe(root, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    const letGo = () => {
      moved = true;
    };
    const input = ["wheel", "touchstart", "keydown", "pointerdown"] as const;
    for (const type of input) root.addEventListener(type, letGo);
    root.addEventListener("scroll", schedule, { passive: true });
    schedule();
    return () => {
      cancelAnimationFrame(frame);
      watch.disconnect();
      root.removeEventListener("scroll", schedule);
      for (const type of input) root.removeEventListener(type, letGo);
      unpaint(owner);
    };
  }, [open, results, pinned, owner]);

  const close = useCallback(() => {
    setOpen(false);
    setPinned(null);
    shown.current = null;
  }, []);

  return {
    open,
    show: useCallback(() => setOpen(true), []),
    close,
    query,
    setQuery,
    status,
    // 1-based, newest first; 0 with nothing found.
    position: target ? index + 1 : 0,
    // A capped count is a floor: never fewer than the matches walked so far.
    total: Math.max(results?.total ?? 0, targets.length),
    capped: results?.capped ?? false,
    next: useCallback(() => go(1), [go]),
    previous: useCallback(() => go(-1), [go]),
  };
}

/**
 * ⌘F (Ctrl+F off a Mac) in this chat, or the phone header's search button,
 * opens the find bar; pressed again, the field takes the caret. Returns a
 * counter that changes each time, for the bar to focus on.
 */
export function useFindShortcut(
  sessionId: string,
  rootRef: RefObject<HTMLElement | null>,
  active: boolean,
  show: () => void
): number {
  const [focus, setFocus] = useState(0);
  const activeRef = useRef(active);
  useEffect(() => {
    activeRef.current = active;
  });
  useEffect(() => {
    const open = () => {
      show();
      setFocus((n) => n + 1);
    };
    const onKey = (e: KeyboardEvent) => {
      const here =
        rootRef.current?.contains(e.target as Node) ||
        (activeRef.current && e.target === document.body);
      if (!here || !isFindKey(e)) return;
      e.preventDefault();
      open();
    };
    const onFind = (e: Event) => {
      if ((e as CustomEvent<string>).detail === sessionId) open();
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener(FIND_EVENT, onFind);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener(FIND_EVENT, onFind);
    };
  }, [sessionId, show, rootRef]);
  return focus;
}
