import "@/components/Chat/composer/test-dom";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mutate = vi.fn();
vi.mock("@/data/session-groups", () => ({
  useCreateGroup: () => ({ mutate }),
}));

// Radix menus need a real browser; render the item inline.
vi.mock("@/components/ui/context-menu", async () => {
  const { createElement: h } = await import("react");
  const part = (p: { children?: unknown }) =>
    h("div", null, p.children as never);
  return {
    ContextMenu: part,
    ContextMenuTrigger: part,
    ContextMenuContent: part,
    ContextMenuItem: (p: { children?: unknown; onSelect?: () => void }) =>
      h("button", { onClick: p.onSelect }, p.children as never),
  };
});

vi.mock("@/components/ui/dialog", async () => {
  const { createElement: h } = await import("react");
  const part = (p: { children?: unknown; open?: boolean }) =>
    p.open === false ? null : h("div", null, p.children as never);
  return {
    Dialog: part,
    DialogContent: part,
    DialogHeader: part,
    DialogTitle: part,
  };
});

import { SidebarContextMenu, isEditableTarget } from "./SidebarContextMenu";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLElement;
beforeEach(() => {
  mutate.mockClear();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() =>
    root.render(createElement(SidebarContextMenu, { workspaceId: "w1" }, "x"))
  );
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.body.innerHTML = "";
});

const openDialog = () =>
  act(() => {
    host.querySelector("button")!.click();
  });
const type = (value: string) => {
  const input = document.body.querySelector("input")!;
  act(() => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value"
    )!.set!.call(input, value);
    input.dispatchEvent(new window.Event("input", { bubbles: true }));
  });
};
const submit = () =>
  act(() => {
    document.body
      .querySelector("form")!
      .dispatchEvent(
        new window.Event("submit", { bubbles: true, cancelable: true })
      );
  });

describe("SidebarContextMenu", () => {
  it("creates a group in the workspace from the typed name", () => {
    openDialog();
    type("  Docs  ");
    submit();
    expect(mutate).toHaveBeenCalledWith({ name: "Docs", workspaceId: "w1" });
  });

  it("does nothing for an empty name", () => {
    openDialog();
    type("   ");
    submit();
    expect(mutate).not.toHaveBeenCalled();
  });

  it("leaves text fields to the browser's menu", () => {
    const input = document.createElement("input");
    const div = document.createElement("div");
    expect(isEditableTarget(input)).toBe(true);
    expect(isEditableTarget(div)).toBe(false);
  });
});
