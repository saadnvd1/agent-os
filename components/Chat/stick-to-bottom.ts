/**
 * Follows the end of a scrolling conversation only while the reader is
 * there. Whether to follow is decided by what the reader DID, not by how far
 * from the end they happen to be: the first upward wheel, swipe, key or
 * scrollbar drag lets go at once, and nothing moves their view again until
 * they come back to the bottom themselves (or jump there).
 *
 * Content growing, rows expanding and images loading never let go, since only
 * the reader's own scrolling does. While they're away from the end, the text
 * under their eyes is held in place the way CSS scroll anchoring would (the
 * virtualized list turns that off, and Safari lacks it): the element at the
 * top of the view is remembered, and when a layout change moves it, the
 * scroll moves by the same amount.
 */

import {
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

// How close to the end counts as "at the bottom", in CSS pixels.
export const NEAR_BOTTOM_PX = 32;
// How long after a wheel or key a scroll still counts as the reader's.
const INTENT_MS = 250;
// Touch momentum (iOS) keeps scrolling after the finger lifts.
const MOMENTUM_MS = 1500;

const UP_KEYS = new Set(["ArrowUp", "PageUp", "Home"]);

export interface ScrollMetrics {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}

export const distanceFromBottom = (m: ScrollMetrics) =>
  m.scrollHeight - m.scrollTop - m.clientHeight;

/**
 * The next stuck state after a scroll event. A scroll up by the reader lets
 * go; any other scroll that ends at the bottom sticks again.
 */
export function nextStuck(
  stuck: boolean,
  e: { prevTop: number; metrics: ScrollMetrics; byUser: boolean }
): boolean {
  if (e.byUser && e.metrics.scrollTop < e.prevTop - 0.5) return false;
  if (distanceFromBottom(e.metrics) <= NEAR_BOTTOM_PX) return true;
  return stuck;
}

const canScroll = (el: HTMLElement) => el.scrollHeight > el.clientHeight + 1;

/** How far to scroll so an anchor that moved from `was` to `now` is back. */
export const anchorCorrection = (was: number, now: number) =>
  Math.abs(now - was) < 0.5 ? 0 : now - was;

/**
 * Binds the behaviour to a scroll container. `onChange` hears every change
 * of the stuck state; the returned controller pins and unbinds.
 */
export function stickToBottom(
  el: HTMLElement,
  onChange: (stuck: boolean) => void,
  now: () => number = Date.now
) {
  let stuck = true;
  let prevTop = el.scrollTop;
  let intentUntil = 0;
  let touching = false;
  let touchY = 0;
  let dragging = false;
  let anchors: { node: Element; top: number }[] = [];
  const doc = el.ownerDocument;
  const win = doc.defaultView;

  const set = (next: boolean) => {
    if (next === stuck) return;
    stuck = next;
    onChange(stuck);
  };
  // Elements down the top of the view, so one that a collapse removes has
  // others below it to fall back on.
  const pickAnchors = () => {
    anchors = [];
    if (stuck || typeof doc.elementFromPoint !== "function") return;
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2;
    for (let y = r.top + 8; y < r.bottom && anchors.length < 4; y += 48) {
      const node = doc.elementFromPoint(x, y);
      if (!node || node === el || !el.contains(node)) continue;
      if (anchors.some((a) => a.node === node)) continue;
      // A whole message doesn't move when something inside it grows.
      const box = node.getBoundingClientRect();
      if (box.height > r.height / 2) continue;
      anchors.push({ node, top: box.top });
    }
  };
  const holdAnchor = () => {
    for (const a of anchors) {
      const box = a.node.isConnected && a.node.getBoundingClientRect();
      if (!box || (!box.width && !box.height)) continue;
      const shift = anchorCorrection(a.top, box.top);
      if (shift) {
        el.scrollTop += shift;
        prevTop = el.scrollTop;
      }
      break;
    }
    pickAnchors();
  };
  const pin = () => {
    if (!stuck) return holdAnchor();
    const end = el.scrollHeight - el.clientHeight;
    if (el.scrollTop < end) el.scrollTop = end;
    prevTop = el.scrollTop;
  };
  // The reader starts moving up: let go before the next pin can undo it.
  const letGo = () => {
    intentUntil = now() + INTENT_MS;
    if (canScroll(el)) set(false);
    pickAnchors();
  };

  const onScroll = () => {
    const byUser = touching || dragging || now() < intentUntil;
    set(nextStuck(stuck, { prevTop, metrics: el, byUser }));
    prevTop = el.scrollTop;
    pickAnchors();
    observeRows();
  };
  const onWheel = (e: WheelEvent) => {
    if (e.deltaY < 0) letGo();
    else intentUntil = now() + INTENT_MS;
  };
  const onTouchStart = (e: TouchEvent) => {
    touching = true;
    touchY = e.touches[0]?.clientY ?? 0;
  };
  const onTouchMove = (e: TouchEvent) => {
    const y = e.touches[0]?.clientY ?? touchY;
    // A finger moving down scrolls the content up.
    if (y > touchY + 1) letGo();
    touchY = y;
  };
  const onTouchEnd = () => {
    touching = false;
    intentUntil = now() + MOMENTUM_MS;
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (UP_KEYS.has(e.key) || (e.key === " " && e.shiftKey)) letGo();
    else intentUntil = now() + INTENT_MS;
  };
  // Only a press on the container itself is its scrollbar.
  const onPointerDown = (e: PointerEvent) => {
    if (e.target === el) dragging = true;
  };
  const onPointerUp = () => {
    if (!dragging) return;
    dragging = false;
    intentUntil = now() + INTENT_MS;
  };

  const passive = { passive: true } as const;
  el.addEventListener("scroll", onScroll, passive);
  el.addEventListener("wheel", onWheel, passive);
  el.addEventListener("touchstart", onTouchStart, passive);
  el.addEventListener("touchmove", onTouchMove, passive);
  el.addEventListener("touchend", onTouchEnd, passive);
  el.addEventListener("touchcancel", onTouchEnd, passive);
  el.addEventListener("keydown", onKeyDown);
  el.addEventListener("pointerdown", onPointerDown, passive);
  win?.addEventListener("pointerup", onPointerUp, passive);

  // Content or the container changing size keeps a stuck reader at the end.
  // The rows are watched too (the list's are three levels down, and come and
  // go as it virtualizes), so a row growing is corrected before it's painted
  // rather than a frame later, when the list catches up.
  const resize =
    typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(() => {
          pin();
          observeRows();
        });
  function observeRows() {
    for (const row of el.querySelectorAll(
      ":scope > *, :scope > * > *, :scope > * > * > *, :scope > * > * > * > *"
    ))
      resize?.observe(row);
  }
  resize?.observe(el);
  observeRows();

  return {
    isStuck: () => stuck,
    pin,
    /** Back to the end, following again. */
    toBottom() {
      set(true);
      pin();
    },
    dispose() {
      resize?.disconnect();
      el.removeEventListener("scroll", onScroll);
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
      el.removeEventListener("touchcancel", onTouchEnd);
      el.removeEventListener("keydown", onKeyDown);
      el.removeEventListener("pointerdown", onPointerDown);
      win?.removeEventListener("pointerup", onPointerUp);
    },
  };
}

/**
 * The hook over `stickToBottom`, for a list that exposes its scroll
 * container (`key` re-binds when it's replaced); `latest` changes whenever
 * something new arrives, which pins a stuck reader and marks it unread for
 * one who has scrolled away.
 */
export function useStickToBottom(
  list: RefObject<{ getScrollableNode(): unknown } | null>,
  key: unknown,
  latest: unknown
) {
  const ctl = useRef<ReturnType<typeof stickToBottom> | null>(null);
  const latestRef = useRef(latest);
  // Stuck, or the newest thing there was when the reader let go.
  const [away, setAway] = useState<{ seen: unknown } | null>(null);

  useEffect(() => {
    let frame = 0;
    // The list mounts its scroller a frame after it renders.
    const bind = () => {
      const el = list.current?.getScrollableNode();
      if (!(el instanceof HTMLElement)) {
        frame = requestAnimationFrame(bind);
        return;
      }
      ctl.current = stickToBottom(el, (stuck) =>
        setAway(stuck ? null : { seen: latestRef.current })
      );
    };
    bind();
    return () => {
      cancelAnimationFrame(frame);
      ctl.current?.dispose();
      ctl.current = null;
      setAway(null);
    };
  }, [list, key]);

  useEffect(() => {
    latestRef.current = latest;
    const c = ctl.current;
    if (c?.isStuck()) requestAnimationFrame(() => c.pin());
  }, [latest]);

  const toBottom = useCallback(() => ctl.current?.toBottom(), []);

  const stuck = away === null;
  const unread = !stuck && away.seen !== latest;
  return { stuck, unread, toBottom };
}
