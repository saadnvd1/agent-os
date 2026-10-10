import { JSDOM } from "jsdom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  anchorCorrection,
  NEAR_BOTTOM_PX,
  nextStuck,
  stickToBottom,
} from "./stick-to-bottom";

// The suite's setup needs node, so the DOM is built here.
const { window } = new JSDOM("<!doctype html><body></body>");
const { document } = window;

const at = (scrollTop: number, scrollHeight = 2000, clientHeight = 500) => ({
  scrollTop,
  scrollHeight,
  clientHeight,
});

describe("nextStuck", () => {
  it("lets go on the reader's first scroll up, even a pixel from the end", () => {
    expect(
      nextStuck(true, { prevTop: 1500, metrics: at(1499), byUser: true })
    ).toBe(false);
  });

  it("stays stuck when the page moves up on its own (content shrinking)", () => {
    expect(
      nextStuck(true, { prevTop: 1500, metrics: at(1200), byUser: false })
    ).toBe(true);
  });

  it("sticks again once a scroll ends near the bottom", () => {
    const end = 1500 - NEAR_BOTTOM_PX;
    expect(
      nextStuck(false, { prevTop: 1000, metrics: at(end), byUser: true })
    ).toBe(true);
  });

  it("stays let go anywhere above the threshold", () => {
    const above = 1500 - NEAR_BOTTOM_PX - 1;
    expect(
      nextStuck(false, { prevTop: 1000, metrics: at(above), byUser: true })
    ).toBe(false);
    expect(
      nextStuck(false, { prevTop: 1000, metrics: at(above), byUser: false })
    ).toBe(false);
  });
});

describe("anchorCorrection", () => {
  it("scrolls by however far the anchor moved, ignoring sub-pixel noise", () => {
    expect(anchorCorrection(100, 250)).toBe(150);
    expect(anchorCorrection(100, 40)).toBe(-60);
    expect(anchorCorrection(100, 100.3)).toBe(0);
  });
});

// A scroll container whose geometry the test sets, since jsdom lays nothing out.
function scroller(height = 2000, view = 500) {
  const el = document.createElement("div");
  document.body.append(el);
  const box = { top: height - view, height, view };
  Object.defineProperties(el, {
    scrollTop: {
      get: () => box.top,
      set: (v: number) => {
        box.top = Math.max(0, Math.min(v, box.height - box.view));
        el.dispatchEvent(new window.Event("scroll"));
      },
    },
    scrollHeight: { get: () => box.height },
    clientHeight: { get: () => box.view },
  });
  return { el, box };
}

const wheel = (el: HTMLElement, deltaY: number) =>
  el.dispatchEvent(new window.WheelEvent("wheel", { deltaY }));

function touch(el: HTMLElement, type: string, y?: number) {
  const e = new window.Event(type);
  Object.defineProperty(e, "touches", {
    value: y === undefined ? [] : [{ clientY: y }],
  });
  el.dispatchEvent(e);
}

describe("stickToBottom", () => {
  let changes: boolean[];
  let ctl: ReturnType<typeof stickToBottom>;
  let el: HTMLElement;
  let box: { top: number; height: number; view: number };

  beforeEach(() => {
    changes = [];
    ({ el, box } = scroller());
    ctl = stickToBottom(el, (s) => changes.push(s));
  });
  afterEach(() => {
    ctl.dispose();
    el.remove();
  });

  // New output arriving: the content grows, then the observer fires.
  const grow = (px: number) => {
    box.height += px;
    ctl.pin();
  };

  it("follows new output while the reader is at the end", () => {
    grow(300);
    expect(box.top).toBe(box.height - box.view);
    expect(ctl.isStuck()).toBe(true);
  });

  it("never moves a reader who scrolled up, however much arrives", () => {
    wheel(el, -4);
    el.scrollTop -= 4;
    const top = box.top;
    grow(300);
    grow(5000);
    expect(box.top).toBe(top);
    expect(changes).toEqual([false]);
  });

  it("lets go on the wheel itself, before a pin can undo the scroll", () => {
    wheel(el, -1);
    expect(ctl.isStuck()).toBe(false);
    grow(100);
    expect(box.top).toBe(1500);
  });

  it("sticks again when the reader scrolls back to the end", () => {
    wheel(el, -100);
    el.scrollTop -= 600;
    wheel(el, 100);
    el.scrollTop = box.height;
    expect(changes).toEqual([false, true]);
    grow(200);
    expect(box.top).toBe(box.height - box.view);
  });

  it("jumps back to the end and follows again on toBottom", () => {
    wheel(el, -100);
    el.scrollTop -= 600;
    grow(400);
    ctl.toBottom();
    expect(box.top).toBe(box.height - box.view);
    expect(ctl.isStuck()).toBe(true);
    grow(100);
    expect(box.top).toBe(box.height - box.view);
  });

  it("stays stuck when content shrinks and the browser clamps the scroll", () => {
    box.height -= 300;
    el.scrollTop = box.top; // the clamp, with no input from the reader
    expect(ctl.isStuck()).toBe(true);
  });

  it("lets go when a finger drags the content down (scrolling up)", () => {
    touch(el, "touchstart", 400);
    touch(el, "touchmove", 410);
    expect(ctl.isStuck()).toBe(false);
  });

  it("keeps following a swipe toward the end", () => {
    touch(el, "touchstart", 400);
    touch(el, "touchmove", 380);
    touch(el, "touchend");
    expect(ctl.isStuck()).toBe(true);
  });

  it("treats momentum after the finger lifts as the reader's scrolling", () => {
    touch(el, "touchstart", 400);
    touch(el, "touchend");
    el.scrollTop -= 200; // momentum, no finger on the screen
    expect(ctl.isStuck()).toBe(false);
  });

  it("lets go on keys that scroll up", () => {
    el.dispatchEvent(new window.KeyboardEvent("keydown", { key: "PageUp" }));
    expect(ctl.isStuck()).toBe(false);
  });

  it("ignores a wheel up when there is nothing to scroll", () => {
    box.height = box.view;
    box.top = 0;
    wheel(el, -100);
    expect(ctl.isStuck()).toBe(true);
  });

  it("holds the text in view still when content above it changes height", () => {
    // The line sits at a fixed spot in the content; on screen, that's less
    // however far the content is scrolled.
    const line = document.createElement("p");
    el.append(line);
    let linePos = 820;
    line.getBoundingClientRect = () =>
      ({ top: linePos - box.top, height: 20, width: 300 }) as DOMRect;
    el.getBoundingClientRect = () =>
      ({ top: 0, bottom: 500, left: 0, width: 400, height: 500 }) as DOMRect;
    document.elementFromPoint = () => line;

    wheel(el, -100);
    el.scrollTop = 700; // the reader settles here, the line 120px down
    expect(line.getBoundingClientRect().top).toBe(120);

    // A row above expands by 150px and pushes the line down: the scroll follows.
    box.height += 150;
    linePos += 150;
    ctl.pin();
    expect(line.getBoundingClientRect().top).toBe(120);

    // It collapses again.
    box.height -= 150;
    linePos -= 150;
    ctl.pin();
    expect(line.getBoundingClientRect().top).toBe(120);
    expect(box.top).toBe(700);
  });
});
