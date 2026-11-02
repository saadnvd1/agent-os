import "@/components/Chat/composer/test-dom";
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as DM from "@/components/ui/dropdown-menu";
import { keepRenameFocus, RowRename, useRenameInput } from "./RowParts";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

// Radix dispatches CustomEvents; node's own class is rejected by jsdom.
(globalThis as { CustomEvent?: unknown }).CustomEvent = window.CustomEvent;

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

// A row whose menu has a Rename item, wired like RowShell / GroupShelves.
function Row({ group = false }: { group?: boolean }) {
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState("old");
  const rename = useRenameInput(() => setRenaming(false));
  const menu = createElement(
    DM.DropdownMenu,
    { defaultOpen: true },
    createElement(
      DM.DropdownMenuTrigger,
      { asChild: true },
      createElement("button", { "aria-label": "menu" })
    ),
    createElement(
      DM.DropdownMenuContent,
      { onCloseAutoFocus: keepRenameFocus },
      createElement(
        DM.DropdownMenuItem,
        { onSelect: () => setRenaming(true) },
        "Rename"
      )
    )
  );
  return createElement(
    "div",
    null,
    menu,
    renaming
      ? group
        ? createElement("input", {
            ...rename,
            value: name,
            onChange: (e: { target: { value: string } }) =>
              setName(e.target.value),
          })
        : createElement(RowRename, {
            initial: name,
            onDone: () => setRenaming(false),
          })
      : null
  );
}

describe.each([
  ["session row", false],
  ["group header", true],
])("rename from the menu on a fresh mount (%s)", (_n, group) => {
  it("keeps the input open, focused, and accepting typing", async () => {
    vi.useRealTimers();
    act(() => root.render(createElement(Row, { group })));
    const item = [...document.querySelectorAll('[role="menuitem"]')].find(
      (el) => el.textContent === "Rename"
    ) as HTMLElement;
    expect(item).toBeTruthy();
    await act(async () => {
      item.click();
      await new Promise((r) => setTimeout(r, 100));
    });
    const el = input();
    expect(el).toBeTruthy();
    expect(document.activeElement).toBe(el);
    const set = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value"
    )!.set!;
    act(() => {
      set.call(el, "typed");
      el.dispatchEvent(new window.Event("input", { bubbles: true }));
    });
    expect(input()).toBe(el);
    expect(input().value).toBe("typed");
  });
});

describe("RowRename", () => {
  it("ignores a blur that comes before it was ever focused", () => {
    const done = vi.fn();
    mount(done);
    // an open menu keeps the input from taking focus on mount
    act(() => input().dispatchEvent(new window.FocusEvent("blur")));
    expect(done).not.toHaveBeenCalled();
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
  it("takes the focus the menu would return, only while a rename input is open", () => {
    const e = { preventDefault: vi.fn() } as unknown as Event;
    keepRenameFocus(e);
    expect(e.preventDefault).not.toHaveBeenCalled();
    mount(() => {});
    keepRenameFocus(e);
    expect(e.preventDefault).toHaveBeenCalled();
    expect(document.activeElement).toBe(input());
  });
});
