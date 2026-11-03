import "@/components/Chat/composer/test-dom";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "@/lib/db/types";
import type { SidebarRow } from "@/lib/sidebar/shelves";
import { RowProvider, type RowContextValue } from "./RowContext";
import { SessionRowMenu } from "./SessionRowMenu";

// Radix's focus handling needs a real browser; plain elements show what the
// menu offers.
vi.mock("@/components/ui/dropdown-menu", async (importOriginal) => {
  const { createElement: h } = await import("react");
  const part = (props: { children?: unknown; onClick?: () => void }) =>
    h("div", { onClick: props.onClick }, props.children as never);
  return {
    ...(await importOriginal<object>()),
    DropdownMenuItem: part,
    DropdownMenuSeparator: part,
    DropdownMenuSub: part,
    DropdownMenuSubTrigger: part,
    DropdownMenuSubContent: part,
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

const ctx: RowContextValue = {
  summarizingSessionId: null,
  projects: [],
  projectNames: new Map(),
  workspaceNames: new Map(),
  orchestrators: [],
  runningByWorkspace: new Map(),
  queuedByWorkspace: new Map(),
  rollups: new Map(),
  orchestratorNames: new Map(),
  orderedIds: () => [],
  cardUrl: () => null,
  onSelect: vi.fn(),
  onRename: vi.fn(),
  onFork: vi.fn(),
  onSummarize: vi.fn(),
  onDelete: vi.fn(),
  onMoveToProject: vi.fn(),
  onPin: vi.fn(),
  onFresh: vi.fn(),
};

async function menuText(session: Partial<Session>) {
  const full = { id: "s1", name: "Fix typo", ...session } as Session;
  const row: SidebarRow = {
    session: full,
    status: undefined,
    need: null,
    unread: false,
    working: false,
    activeAt: 0,
    workers: [],
  };
  await act(async () =>
    root.render(
      createElement(
        QueryClientProvider,
        { client: new QueryClient() },
        createElement(
          RowProvider,
          { value: ctx },
          createElement(SessionRowMenu, {
            session: full,
            row,
            kind: "dropdown",
            onRename: () => {},
          })
        )
      )
    )
  );
  return document.body.textContent ?? "";
}

describe("SessionRowMenu", () => {
  it("gives a quick change Done, Archive and Delete", async () => {
    const text = await menuText({
      quick_of: "o1",
      task_status: "running",
      role: null,
    });
    expect(text).toContain("Done");
    expect(text).toContain("Archive");
    expect(text).toContain("Delete session");
  });

  it("gives an orchestrator neither Done nor Archive", async () => {
    const text = await menuText({ role: "orchestrator" });
    expect(text).not.toContain("Done");
    expect(text).not.toContain("Archive");
  });
});

describe("QuickChangeRow", () => {
  it("has a row menu to finish it from", async () => {
    const { QuickChangeRow } = await import("./QuickChangeRow");
    const session = {
      id: "q1",
      name: "Fix typo",
      quick_of: "o1",
      task_status: "running",
    } as Session;
    await act(async () =>
      root.render(
        createElement(
          QueryClientProvider,
          { client: new QueryClient() },
          createElement(
            RowProvider,
            { value: ctx },
            createElement(QuickChangeRow, {
              row: {
                session,
                status: undefined,
                need: null,
                unread: false,
                working: false,
                activeAt: 0,
                workers: [],
              },
            })
          )
        )
      )
    );
    expect(
      host.querySelector('[aria-label="Quick change actions"]')
    ).not.toBeNull();
  });
});
