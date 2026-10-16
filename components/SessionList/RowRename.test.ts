import "@/components/Chat/composer/test-dom";
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { keepRenameFocus, RowRename } from "./RowParts";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLElement;
const input = () => host.querySelector("input")!;

beforeEach(() => {
  vi.useFakeTimers();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});

function mount(onDone: (n: string | null) => void, initial = "old") {
  act(() => root.render(createElement(RowRename, { initial, onDone })));
}

describe("RowRename", () => {
  it("retries focus the menu stole, and ignores blur until it has it", () => {
    const real = window.HTMLElement.prototype.focus;
    let calls = 0;
    // The first focus attempts land while the menu still traps focus.
    vi.spyOn(window.HTMLElement.prototype, "focus").mockImplementation(
      function (this: HTMLElement) {
        if (++calls > 2) real.call(this);
      }
    );
    const done = vi.fn();
    mount(done);
    act(() => input().dispatchEvent(new window.FocusEvent("blur")));
    expect(done).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(150));
    expect(document.activeElement).toBe(input());
    vi.restoreAllMocks();
  });

  it("keeps typed text across a parent re-render (list refresh)", () => {
    function Parent() {
      const [n, setN] = useState(0);
      return createElement(
        "div",
        null,
        createElement("button", { onClick: () => setN(n + 1) }),
        createElement(RowRename, { initial: "old", onDone: () => {} })
      );
    }
    act(() => root.render(createElement(Parent)));
    const el = input();
    act(() => {
      const set = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value"
      )!.set!;
      set.call(el, "typed");
      el.dispatchEvent(new window.Event("input", { bubbles: true }));
    });
    act(() => host.querySelector("button")!.click());
    expect(input()).toBe(el);
    expect(input().value).toBe("typed");
  });

  it("saves on Enter, cancels on Escape, saves on blur once focused", () => {
    const done = vi.fn();
    mount(done);
    act(() => vi.advanceTimersByTime(60));
    const key = (k: string) =>
      act(() => {
        input().dispatchEvent(
          new window.KeyboardEvent("keydown", { key: k, bubbles: true })
        );
      });
    key("Enter");
    expect(done).toHaveBeenLastCalledWith("old");
    key("Escape");
    expect(done).toHaveBeenLastCalledWith(null);
    act(() => input().blur());
    expect(done).toHaveBeenCalledTimes(3);
  });
});

describe("keepRenameFocus", () => {
  it("stops the menu returning focus only while renaming", () => {
    const e = { preventDefault: vi.fn() } as unknown as Event;
    keepRenameFocus(false)(e);
    expect(e.preventDefault).not.toHaveBeenCalled();
    keepRenameFocus(true)(e);
    expect(e.preventDefault).toHaveBeenCalled();
  });
});
