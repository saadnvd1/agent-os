import { describe, expect, it } from "vitest";
import { showDraft, type PaneData } from "./panes";

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
