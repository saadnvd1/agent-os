import { describe, expect, it } from "vitest";
import {
  countPanes,
  createInitialPaneState,
  MAX_PANES,
  openBeside,
  showDraft,
  splitPane,
  type PaneData,
} from "./panes";

const pane = (): PaneData => ({
  activeTabId: "t2",
  tabs: [
    { id: "t1", sessionId: null, attachedTmux: null, draftId: "d1" },
    { id: "t2", sessionId: "s1", attachedTmux: "claude-s1" },
  ],
});

describe("showDraft", () => {
  it("switches to the tab already showing the draft", () => {
    const next = showDraft(pane(), "d1");
    expect(next.activeTabId).toBe("t1");
    expect(next.tabs[1].sessionId).toBe("s1");
  });

  it("puts a new draft in the active tab, in place of its session", () => {
    const next = showDraft(pane(), "d2");
    expect(next.activeTabId).toBe("t2");
    expect(next.tabs[1]).toMatchObject({
      draftId: "d2",
      sessionId: null,
      attachedTmux: null,
    });
  });
});

describe("openBeside", () => {
  const open = { sessionId: "analyst", tmux: "claude-analyst" };

  it("splits to the right and shows the session there", () => {
    const state = createInitialPaneState();
    const first = state.focusedPaneId;
    const next = openBeside(state, first, open);
    expect(countPanes(next.layout)).toBe(2);
    expect(next.layout).toMatchObject({
      type: "split",
      direction: "horizontal",
    });
    const right = next.panes[next.focusedPaneId];
    expect(next.focusedPaneId).not.toBe(first);
    expect(right.tabs[0]).toMatchObject({
      sessionId: "analyst",
      attachedTmux: "claude-analyst",
    });
  });

  it("focuses a pane already showing it rather than opening another", () => {
    const start = createInitialPaneState();
    const twice = openBeside(
      openBeside(start, start.focusedPaneId, open),
      start.focusedPaneId,
      open
    );
    expect(countPanes(twice.layout)).toBe(2);
    expect(twice.panes[twice.focusedPaneId].tabs[0].sessionId).toBe("analyst");
  });

  it("opens a tab in the same pane when there's no room for another", () => {
    let state = createInitialPaneState();
    const first = state.focusedPaneId;
    for (let i = 0; i < MAX_PANES - 1; i++)
      state = splitPane(state, first, "vertical")!;
    const next = openBeside(state, first, open);
    expect(countPanes(next.layout)).toBe(MAX_PANES);
    expect(next.focusedPaneId).toBe(first);
    expect(next.panes[first].tabs).toHaveLength(2);
    expect(next.panes[first].tabs[1].sessionId).toBe("analyst");
  });
});
