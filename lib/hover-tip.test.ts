import { JSDOM } from "jsdom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  installHoverTip,
  OPEN_DELAY_MS,
  registerTip,
  WARM_MS,
} from "./hover-tip";

const window = new JSDOM("<!doctype html><body></body>", {
  pretendToBeVisual: true,
}).window as unknown as Window & typeof globalThis;
const { document } = window;

function stubHover(hover: boolean) {
  window.matchMedia = ((q: string) => ({
    matches: hover,
    media: q,
  })) as unknown as typeof window.matchMedia;
}

const tip = () => document.getElementById("hover-tip");
const shown = () => !!tip() && !tip()!.hidden;
const over = (el: Element) =>
  el.dispatchEvent(new window.Event("pointerover", { bubbles: true }));

describe("hover tip", () => {
  let uninstall: () => void = () => {};
  beforeEach(() => {
    vi.useFakeTimers();
    stubHover(true);
    document.body.innerHTML = `
      <div id="row" data-tip-key="session:s1" data-tip="fallback">
        <span id="badge" data-tip="Plan ready"></span>
        <span id="name">name</span>
      </div>
      <div id="other" data-tip="Other"></div>
      <div id="plain"></div>`;
    uninstall = installHoverTip(window);
  });
  afterEach(() => {
    uninstall();
    vi.useRealTimers();
  });

  it("opens only after resting on it", () => {
    over(document.getElementById("other")!);
    vi.advanceTimersByTime(OPEN_DELAY_MS - 1);
    expect(shown()).toBe(false);
    vi.advanceTimersByTime(1);
    expect(shown()).toBe(true);
    expect(tip()!.textContent).toBe("Other");
  });

  it("shows nothing for a quick pass", () => {
    over(document.getElementById("other")!);
    vi.advanceTimersByTime(200);
    over(document.getElementById("plain")!);
    vi.advanceTimersByTime(OPEN_DELAY_MS);
    expect(shown()).toBe(false);
  });

  it("opens the next at once while warm, and not after", () => {
    over(document.getElementById("other")!);
    vi.advanceTimersByTime(OPEN_DELAY_MS);
    over(document.getElementById("badge")!);
    expect(shown()).toBe(true);
    expect(tip()!.textContent).toBe("Plan ready");
    over(document.getElementById("plain")!);
    vi.advanceTimersByTime(WARM_MS + 1);
    over(document.getElementById("other")!);
    expect(shown()).toBe(false);
  });

  it("lets the innermost tip win, and resolves keys when it opens", () => {
    const resolve = vi.fn(() => ({
      title: "<b>Speed</b> up",
      lines: [["State", "Planning"]] as [string, string][],
    }));
    const unregister = registerTip("session", resolve);
    over(document.getElementById("name")!);
    expect(resolve).not.toHaveBeenCalled();
    vi.advanceTimersByTime(OPEN_DELAY_MS);
    expect(resolve).toHaveBeenCalledWith("s1");
    // Text, never parsed as HTML.
    expect(tip()!.querySelector("b")).toBeNull();
    expect(tip()!.textContent).toContain("<b>Speed</b> up");
    expect(
      document.getElementById("row")!.getAttribute("aria-describedby")
    ).toBe("hover-tip");
    over(document.getElementById("badge")!);
    expect(tip()!.textContent).toBe("Plan ready");
    unregister();
  });

  it("falls back to data-tip when no resolver answers", () => {
    over(document.getElementById("name")!);
    vi.advanceTimersByTime(OPEN_DELAY_MS);
    expect(tip()!.textContent).toBe("fallback");
  });

  it.each(["pointerdown", "keydown", "scroll"])("closes on %s", (type) => {
    over(document.getElementById("other")!);
    vi.advanceTimersByTime(OPEN_DELAY_MS);
    document.dispatchEvent(new window.Event(type));
    expect(shown()).toBe(false);
  });

  it("keeps one element in the page", () => {
    expect(document.querySelectorAll("[role=tooltip]")).toHaveLength(1);
  });

  it("attaches nothing on a touch screen", () => {
    uninstall();
    stubHover(false);
    const add = vi.spyOn(document, "addEventListener");
    uninstall = installHoverTip(window);
    expect(add).not.toHaveBeenCalled();
    expect(tip()).toBeNull();
    add.mockRestore();
  });
});
