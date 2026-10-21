import "@/components/Chat/composer/test-dom";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sessionKeys } from "@/data/sessions/keys";
import type { SessionGroup } from "@/lib/sidebar/shelves";
import { groupTargets } from "./SidebarContextMenu";

// Radix menus need a real browser; plain elements show what the menu offers.
vi.mock("./RowMenuParts", async () => {
  const { createElement: h } = await import("react");
  const part = (p: { children?: unknown }) =>
    h("div", null, p.children as never);
  return {
    icon: "",
    MenuItem: part,
    Expander: part,
  };
});

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLElement;
beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const group = (id: string, name: string, workspace_id: string | null) =>
  ({ id, name, workspace_id, sort_order: 0 }) as SessionGroup;

async function menuText(groups: SessionGroup[], workspaceId: string | null) {
  const { MoveToGroupMenu } = await import("./MoveToGroupMenu");
  const client = new QueryClient();
  client.setQueryData(sessionKeys.list(), {
    sessions: [],
    sessionGroups: groups,
  });
  await act(async () =>
    root.render(
      createElement(
        QueryClientProvider,
        { client },
        createElement(MoveToGroupMenu, {
          kind: "dropdown",
          sessionId: "s1",
          groupId: null,
          workspaceId,
        })
      )
    )
  );
  return host.textContent ?? "";
}

describe("Move to group", () => {
  it("offers an empty group, and one made from the all-workspaces view", async () => {
    // Viewing every workspace, "New group" files the group under a workspace
    // (it used to be none, which no session can join).
    const [target] = groupTargets(null, [{ id: "w1", name: "Work" }]);
    const text = await menuText(
      [group("g1", "Fresh", target.id), group("g2", "Elsewhere", "w2")],
      "w1"
    );
    expect(text).toContain("Fresh");
    expect(text).not.toContain("Elsewhere");
  });
});
