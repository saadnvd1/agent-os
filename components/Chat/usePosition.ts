"use client";

import {
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { useSnapshot } from "valtio";
import { saveChatView } from "@/data/chat-views";
import type { ChatItem } from "@/lib/chat/events";
import { locate } from "@/lib/chat/find";
import {
  anchorOf,
  decideOpen,
  type Position,
  type RowRect,
} from "@/lib/nav/position";
import { bookmarksUi, bookmarksUiActions } from "@/stores/bookmarksUi";
import { chatPositions, chatPositionsActions } from "@/stores/chatPositions";
import { navHistoryActions } from "@/stores/navHistory";
import { NEAR_BOTTOM_PX, distanceFromBottom } from "./stick-to-bottom";

// A position is saved this long after the reader stops scrolling.
const SAVE_IDLE_MS = 3000;
// Older pages loaded to find where the new items begin, at most.
const MAX_PAGES_FOR_NEW = 5;

interface Deps {
  sessionId: string;
  active: boolean;
  loadedFor: string | null;
  items: ChatItem[];
  hasMore: boolean;
  loadingOlder: boolean;
  loadOlder: () => void;
  listRef: RefObject<HTMLDivElement | null>;
  release: () => void;
  toEnd: () => void;
  foldEvents: boolean;
  // Takes the reader to a message by a rule over the items (bookmarks).
  goTo: (match: (items: ChatItem[]) => string | null) => void;
}

type Job =
  | { sessionId: string; kind: "block"; block: string; offsetPx: number }
  | { sessionId: string; kind: "new"; viewedAt: number; pages: number };

const afterLayout = (fn: () => void) =>
  requestAnimationFrame(() => requestAnimationFrame(fn));

/**
 * Where a chat is when it opens, and remembering where the reader leaves it.
 *
 * Tracking: the first row in view and its offset are kept as the reader
 * scrolls, written into the current history entry (so back lands there) and
 * saved to the server when they leave, hide the page, or stop scrolling.
 * Only after the reader's own scrolling or tapping: an idle tab left at the
 * end can't overwrite the place they are reading on another device.
 *
 * Opening (lib/nav/position.decideOpen): a place a history entry or a
 * bookmark asked for, else the first item newer than the last time it was
 * open (with a "New" divider above it), else where it was left, else the
 * latest message.
 */
export function usePosition(d: Deps) {
  const { sessionId, active, loadedFor, listRef } = d;
  const latest = useRef(d);
  useEffect(() => {
    latest.current = d;
  });
  const st = useRef({
    sessionId: "",
    decided: false,
    settled: false,
    touched: false,
    dirty: false,
    pos: null as Position | null,
    idle: undefined as ReturnType<typeof setTimeout> | undefined,
  });
  const [job, setJob] = useState<Job | null>(null);
  const [divider, setDivider] = useState<{
    sessionId: string;
    block: string;
  } | null>(null);
  const { loaded, target } = useSnapshot(chatPositions);
  const { jump } = useSnapshot(bookmarksUi);

  // A conversation starts at the end, until the open below says otherwise.
  useLayoutEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [sessionId, listRef]);

  const stamp = useCallback((id: string) => {
    saveChatView(id, null);
    const mine = chatPositions.views[id];
    chatPositionsActions.record({
      sessionId: id,
      itemId: mine?.itemId ?? null,
      offsetPx: mine?.offsetPx ?? 0,
      atEnd: mine?.atEnd ?? true,
      viewedAt: Date.now(),
    });
  }, []);

  // Saves where the reader is. Left at the end, everything up to now counts
  // as seen; left higher up, what arrived below does not.
  const save = useCallback(() => {
    const s = st.current;
    if (!s.settled || !s.sessionId) return;
    clearTimeout(s.idle);
    navHistoryActions.flush();
    if (!s.touched || !s.pos) {
      // Not moved by the reader: the place they were given stands. Only a
      // chat watched at its end has seen what arrived since.
      if (!s.pos || s.pos.atEnd) stamp(s.sessionId);
      return;
    }
    const { block, offsetPx, atEnd } = s.pos;
    s.dirty = false;
    saveChatView(s.sessionId, {
      itemId: block,
      offsetPx,
      atEnd,
      advance: atEnd,
    });
    const mine = chatPositions.views[s.sessionId];
    chatPositionsActions.record({
      sessionId: s.sessionId,
      itemId: block,
      offsetPx,
      atEnd,
      viewedAt: atEnd ? Date.now() : (mine?.viewedAt ?? Date.now()),
    });
  }, [stamp]);

  // Track the reader.
  useEffect(() => {
    const el = listRef.current;
    const s = st.current;
    Object.assign(s, {
      sessionId,
      decided: false,
      settled: false,
      touched: false,
      dirty: false,
      pos: null,
    });
    setJob(null);
    setDivider(null);
    if (!el) return;
    let frame = 0;
    const measure = () => {
      frame = 0;
      if (!s.settled || el.offsetParent === null) return;
      const rows: RowRect[] = [];
      for (const r of el.querySelectorAll<HTMLElement>("[data-block]")) {
        const b = r.getBoundingClientRect();
        rows.push({ key: r.dataset.block!, top: b.top, bottom: b.bottom });
      }
      const atEnd =
        distanceFromBottom({
          scrollTop: el.scrollTop,
          scrollHeight: el.scrollHeight,
          clientHeight: el.clientHeight,
        }) <= NEAR_BOTTOM_PX;
      s.pos = anchorOf(el.getBoundingClientRect().top, rows, atEnd);
      navHistoryActions.setPosition(sessionId, s.pos);
      if (s.touched) {
        s.dirty = true;
        clearTimeout(s.idle);
        s.idle = setTimeout(save, SAVE_IDLE_MS);
      }
    };
    const onScroll = () => {
      frame ||= requestAnimationFrame(measure);
    };
    const touch = () => {
      s.touched = true;
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    const hands = ["wheel", "touchmove", "keydown", "pointerdown"] as const;
    for (const e of hands) el.addEventListener(e, touch, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      for (const e of hands) el.removeEventListener(e, touch);
      cancelAnimationFrame(frame);
      save();
      s.settled = false;
    };
  }, [sessionId, listRef, save]);

  // The page going away, or the tab going to the background.
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === "hidden") save();
    };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", save);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", save);
    };
  }, [save]);

  // Another tab of the pane taking over, or coming back.
  const wasActive = useRef(active);
  useEffect(() => {
    const was = wasActive.current;
    wasActive.current = active;
    const s = st.current;
    if (was && !active) save();
    else if (!was && active && s.settled) stamp(sessionId);
  }, [active, save, stamp, sessionId]);

  const place = useCallback(
    (block: string, offsetPx: number) => {
      latest.current.release();
      afterLayout(() => {
        const el = listRef.current;
        const row = el?.querySelector<HTMLElement>(
          `[data-block="${CSS.escape(block)}"]`
        );
        if (!el || !row) return;
        el.scrollTop +=
          row.getBoundingClientRect().top -
          el.getBoundingClientRect().top -
          offsetPx;
        // The view held its anchors from before the jump: take new ones, or
        // the next layout change would carry the view back to them.
        latest.current.release();
        st.current.settled = true;
        st.current.pos = null;
        el.dispatchEvent(new Event("scroll"));
      });
    },
    [listRef]
  );

  // Open: a place asked for, else the rule above.
  useEffect(() => {
    const el = listRef.current;
    const s = st.current;
    if (loadedFor !== sessionId || !loaded || !el || el.offsetParent === null)
      return;
    const asked = chatPositionsActions.takeTarget(sessionId);
    if (asked) {
      s.decided = true;
      if (asked.atEnd || !asked.block) {
        s.settled = true;
        latest.current.toEnd();
      } else
        setJob({
          sessionId,
          kind: "block",
          block: asked.block,
          offsetPx: asked.offsetPx,
        });
      stamp(sessionId);
      return;
    }
    if (jump && jump.sessionId === sessionId) {
      const itemId = bookmarksUiActions.takeJump(sessionId);
      s.decided = true;
      s.settled = true;
      stamp(sessionId);
      if (itemId)
        latest.current.goTo((all) =>
          all.some((i) => i.id === itemId) ? itemId : null
        );
      return;
    }
    if (s.decided) return;
    s.decided = true;
    const view = chatPositions.views[sessionId] ?? null;
    const open = decideOpen({
      view,
      items: latest.current.items,
      latest: chatPositionsActions.takeLatest(sessionId),
    });
    stamp(sessionId);
    if (open.kind === "latest") s.settled = true;
    else if (open.kind === "position")
      setJob({
        sessionId,
        kind: "block",
        block: open.block,
        offsetPx: open.offsetPx,
      });
    else setJob({ sessionId, kind: "new", viewedAt: view!.viewedAt, pages: 0 });
  }, [loadedFor, sessionId, loaded, target, jump, active, listRef, stamp]);

  // Finish a placement that may need older pages first.
  const { items, hasMore, loadingOlder, loadOlder, foldEvents } = d;
  useEffect(() => {
    const el = listRef.current;
    if (!job || job.sessionId !== sessionId || !el || loadingOlder) return;
    const give = () => {
      setJob(null);
      st.current.settled = true;
      latest.current.toEnd();
    };
    if (job.kind === "block") {
      const there = el.querySelector(`[data-block="${CSS.escape(job.block)}"]`);
      if (there) {
        setJob(null);
        place(job.block, job.offsetPx);
      } else if (hasMore) loadOlder();
      else give();
      return;
    }
    const first = items.findIndex((i) => i.createdAt > job.viewedAt);
    if (first === -1) return give();
    if (first === 0 && hasMore && job.pages < MAX_PAGES_FOR_NEW) {
      setJob({ ...job, pages: job.pages + 1 });
      loadOlder();
      return;
    }
    const where = locate(items, items[first].id, { foldEvents });
    if (!where) return give();
    setJob(null);
    if (first > 0) setDivider({ sessionId, block: where.block });
    latest.current.release();
    afterLayout(() => {
      const mark = el.querySelector<HTMLElement>("[data-new-divider]");
      (
        mark ?? el.querySelector(`[data-block="${CSS.escape(where.block)}"]`)
      )?.scrollIntoView({
        block: "start",
      });
      latest.current.release();
      st.current.settled = true;
      el.dispatchEvent(new Event("scroll"));
    });
  }, [
    job,
    items,
    hasMore,
    loadingOlder,
    loadOlder,
    foldEvents,
    sessionId,
    listRef,
    place,
  ]);

  return { newFrom: divider?.sessionId === sessionId ? divider.block : null };
}
