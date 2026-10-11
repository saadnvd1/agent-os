import "@/components/Chat/composer/test-dom";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "@/lib/db/types";
import {
  orchestratorOpenActions,
  orchestratorOpenStore,
} from "@/stores/orchestratorOpen";
import { OrchestratorPinRow, OrchestratorStartRow } from "./OrchestratorPinRow";
import { RowProvider, type RowContextValue } from "./RowContext";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLElement;

beforeEach(() => {
  orchestratorOpenActions.clear();
  host = document.createElement("div");
  root = createRoot(host);
});
afterEach(() => act(() => root.unmount()));

const press = (key: string) =>
  act(() => {
    button().dispatchEvent(
      new window.KeyboardEvent("keydown", { key, bubbles: true })
    );
  });
const button = () => host.querySelector<HTMLElement>('[role="button"]')!;

describe("OrchestratorStartRow", () => {
  beforeEach(async () => {
    await act(async () =>
      root.render(
        createElement(OrchestratorStartRow, {
          workspaceId: "w1",
          name: "Poise",
        })
      )
    );
  });

  it("shows the workspace and offers to start its orchestrator", () => {
    expect(host.textContent).toBe("PoiseStart orchestrator");
  });

  it("asks the page to open (and so make) that workspace's orchestrator", () => {
    act(() => button().click());
    expect(orchestratorOpenStore.request?.workspaceId).toBe("w1");
  });

  it("opens from the keyboard too", () => {
    press("Enter");
    expect(orchestratorOpenStore.request?.workspaceId).toBe("w1");
  });
});

describe("OrchestratorPinRow", () => {
  const onSelect = vi.fn();
  const session = {
    id: "o1",
    name: "Poise orchestrator",
    role: "orchestrator",
    workspace_id: "w1",
    pinned: true,
  } as Session;
  // Typed in full, so a field the row starts reading fails tsc, not CI.
  const ctx: RowContextValue = {
    summarizingSessionId: null,
    projects: [],
    projectNames: new Map(),
    workspaceNames: new Map([["w1", "Poise"]]),
    orchestrators: [],
    runningByWorkspace: new Map(),
    queuedByWorkspace: new Map(),
    orderedIds: () => [],
    cardUrl: () => null,
    onSelect,
    onRename: vi.fn(),
    onFork: vi.fn(),
    onSummarize: vi.fn(),
    onDelete: vi.fn(),
    onMoveToProject: vi.fn(),
    onPin: vi.fn(),
  };
  const render = (over: Partial<RowContextValue> = {}, unread = false) =>
    act(async () =>
      root.render(
        createElement(
          RowProvider,
          { value: { ...ctx, ...over } },
          createElement(OrchestratorPinRow, {
            row: {
              session,
              status: undefined,
              need: null,
              unread,
              working: false,
              workers: [],
            },
          })
        )
      )
    );

  beforeEach(async () => {
    onSelect.mockClear();
    await render();
  });

  it("is Waiting while its workspace has tasks in line, Replied with an unseen reply", async () => {
    expect(host.textContent).toContain("Idle");
    await render({ queuedByWorkspace: new Map([["w1", 2]]) });
    expect(host.textContent).toContain("Waiting");
    expect(host.querySelector('[aria-label="Unread"]')).toBeNull();
    await render({ queuedByWorkspace: new Map([["w1", 2]]) }, true);
    expect(host.textContent).toContain("Replied");
    expect(host.querySelector('[aria-label="Unread"]')).not.toBeNull();
  });

  it("still opens its chat by click and by Enter", () => {
    expect(host.textContent).toContain("Poise");
    act(() => button().click());
    press("Enter");
    expect(onSelect.mock.calls).toEqual([["o1"], ["o1"]]);
    expect(orchestratorOpenStore.request).toBeNull();
  });
});
