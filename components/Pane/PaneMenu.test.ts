import "@/components/Chat/composer/test-dom";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "@/lib/db/types";
import { bookmarksUi } from "@/stores/bookmarksUi";
import { docsUi } from "@/stores/docsUi";
import { paletteUi } from "@/stores/palette";

const data = vi.hoisted(() => ({
  bookmarks: [] as unknown[],
  docs: null as { id: string } | null,
}));
vi.mock("@/data/bookmarks", () => ({
  useSessionBookmarks: () => ({ data: data.bookmarks }),
}));
vi.mock("@/data/lumifyhub/docs", () => ({
  useDocsWorkspace: () => data.docs,
}));
vi.mock("@/components/Tasks/MoveMenuItems", () => ({
  MoveMenuItems: () => null,
}));
// Radix's focus handling needs a real browser; plain elements show what the
// menu offers.
vi.mock("@/components/ui/dropdown-menu", async () => {
  const { createElement: h } = await import("react");
  const part =
    (tag: string) => (props: { children?: unknown; onSelect?: () => void }) =>
      h(tag, { onClick: props.onSelect }, props.children as never);
  return {
    DropdownMenu: part("div"),
    DropdownMenuTrigger: part("div"),
    DropdownMenuContent: part("div"),
    DropdownMenuLabel: part("div"),
    DropdownMenuItem: part("button"),
    DropdownMenuSeparator: part("hr"),
    DropdownMenuShortcut: part("span"),
  };
});

import { PaneMenu } from "./PaneMenu";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const session = {
  id: "s1",
  name: "Chat",
  project_id: "p1",
  view: "chat",
} as Session;

describe("PaneMenu", () => {
  let host: HTMLElement;
  let root: Root;
  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    data.bookmarks = [];
    data.docs = null;
    paletteUi.open = false;
    bookmarksUi.chatSessionId = null;
    docsUi.workspaceId = null;
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });
  const render = (bookmarksSessionId: string | null = "s1") =>
    act(() => {
      root.render(
        createElement(PaneMenu, {
          session,
          bookmarksSessionId,
          canSplit: true,
          canClose: true,
          hasAttachedTmux: false,
          onSplitHorizontal: () => {},
          onSplitVertical: () => {},
          onClose: () => {},
          onDetach: () => {},
        })
      );
    });
  const item = (text: string) =>
    [...host.querySelectorAll("button")].find((b) =>
      b.textContent?.startsWith(text)
    );

  it("always offers the command palette with its shortcut, and opens it", () => {
    render(null);
    const palette = item("Command palette");
    expect(palette?.textContent).toContain("⌘K");
    act(() => palette?.click());
    expect(paletteUi.open).toBe(true);
  });

  it("offers Bookmarks with its count for a chat only", () => {
    data.bookmarks = [{}, {}, {}];
    render();
    expect(item("Bookmarks")?.textContent).toContain("3");
    act(() => root.unmount());
    root = createRoot(host);
    render(null);
    expect(item("Bookmarks")).toBeUndefined();
  });

  it("offers Docs only when the project's workspace has them", () => {
    render();
    expect(item("Docs")).toBeUndefined();
    data.docs = { id: "w1" };
    render();
    act(() => item("Docs")?.click());
    expect(docsUi.workspaceId).toBe("w1");
  });
});
