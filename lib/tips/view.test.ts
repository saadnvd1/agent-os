import { beforeEach, describe, expect, it } from "vitest";
import { putSetting } from "@/lib/settings-store";
import { loadTips } from "./load";
import { guideUrl, markSeen, setTipsOff, tipsView } from "./view";

beforeEach(() => {
  for (const k of ["tips.off", "tips.seen", "tips.today"]) putSetting(k, null);
});

describe("tipsView", () => {
  it("gives a stable tip for the day and a deck with links", () => {
    const a = tipsView("2026-11-01");
    const b = tipsView("2026-11-01");
    expect(a.today).toEqual({ id: expect.any(String), read: false });
    expect(b.today).toEqual(a.today);
    expect(a.deck.length).toBeGreaterThan(10);
    expect(a.deck.find((t) => t.id === "sidebar-pin")?.url).toBe(
      "https://github.com/saadnvd1/agent-os/blob/main/docs/guides/sessions.md#the-sidebar"
    );
    expect(JSON.stringify(a)).not.toContain("mediaBrief");
  });

  it("marks today's tip read and moves to another tip tomorrow", () => {
    const day1 = tipsView("2026-11-01");
    markSeen([day1.today!.id], "2026-11-01");
    expect(tipsView("2026-11-01").today).toEqual({
      id: day1.today!.id,
      read: true,
    });
    expect(tipsView("2026-11-02").today?.id).not.toBe(day1.today!.id);
  });

  it("a tip stepped to counts as seen but leaves today's unread", () => {
    const day1 = tipsView("2026-11-01");
    const other = day1.deck.find((t) => t.id !== day1.today!.id)!;
    markSeen([other.id], "2026-11-01");
    expect(tipsView("2026-11-01").today?.read).toBe(false);
    expect(tipsView("2026-11-02").today?.id).not.toBe(other.id);
  });

  it("hides everything while tips are off, and remembers", () => {
    setTipsOff(true);
    expect(tipsView("2026-11-01")).toMatchObject({
      off: true,
      today: null,
      deck: [],
    });
    setTipsOff(false);
    expect(tipsView("2026-11-01").off).toBe(false);
  });

  it("ignores ids that are not tips", () => {
    markSeen(["no-such-tip"], "2026-11-01");
    expect(tipsView("2026-11-01").today?.read).toBe(false);
  });
});

describe("guideUrl", () => {
  it("links the file, with the anchor when there is one", () => {
    expect(guideUrl({ file: "chat" })).toMatch(/guides\/chat\.md$/);
    expect(loadTips().length).toBeGreaterThan(0);
  });
});
