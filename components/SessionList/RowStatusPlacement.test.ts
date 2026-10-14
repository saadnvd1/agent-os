import "@/components/Chat/composer/test-dom";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "@/lib/db/types";
import type { SidebarRow } from "@/lib/sidebar/shelves";
import { RowProvider, type RowContextValue } from "./RowContext";
import { SessionRow } from "./SessionRow";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLElement;
let root: Root;
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

async function render(
  session: Partial<Session>,
  over: Partial<SidebarRow> = {}
) {
  const row: SidebarRow = {
    session: {
      id: "s1",
      name: "Fix typo",
      task_status: "running",
      chat_plan: 0,
      ...session,
    } as Session,
    status: undefined,
    need: null,
    unread: false,
    working: true,
    activeAt: Date.now() - 60_000,
    workers: [],
    ...over,
  };
  await act(async () =>
    root.render(
      createElement(
        QueryClientProvider,
        { client: new QueryClient() },
        createElement(
          RowProvider,
          { value: ctx },
          createElement(SessionRow, { row })
        )
      )
    )
  );
}

// The slot that goes invisible on hover so the ⋯ can sit on it.
const hoverHidden = () => host.querySelector("[data-hover-hidden]")!;
const badges = () => [...host.querySelectorAll("[data-status-badge]")];

describe("status on a session row", () => {
  it.each([
    ["Plan ready", { plan_phase: "awaiting" as const }, {}],
    ["Planning", { plan_phase: "planning" as const }, {}],
    ["Approve", {}, { need: "approve" as const }],
    ["Stalled", {}, { status: { stalled: true } as SidebarRow["status"] }],
  ])("keeps %s out of the hover-hidden slot", async (label, session, over) => {
    await render(session, over);
    const badge = badges().find((b) => b.textContent?.includes(label));
    expect(badge, label).toBeTruthy();
    expect(hoverHidden().contains(badge!)).toBe(false);
    expect(hoverHidden().textContent).not.toContain(label);
  });

  it("keeps the badge when the session is paused", async () => {
    await render({
      plan_phase: "awaiting" as const,
      pause_state: "snoozed" as never,
    });
    expect(badges().map((b) => b.textContent)).toContain("Plan ready");
  });

  it("puts the time, and only the time, in the hover-hidden slot", async () => {
    await render({ plan_phase: "awaiting" as const });
    expect(hoverHidden().textContent).toMatch(/\d+m|now|\d+h/);
  });
});
