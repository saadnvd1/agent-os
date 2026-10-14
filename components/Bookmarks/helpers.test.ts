import { describe, expect, it } from "vitest";
import type { Bookmark } from "@/lib/bookmarks/types";
import {
  STATE_BADGE,
  canOpen,
  createdAt,
  excerpt,
  groupByDay,
} from "./helpers";

const b = (createdAt: string, state: Bookmark["state"] = "live"): Bookmark => ({
  id: createdAt,
  sessionId: "s",
  itemId: "i",
  scope: "item",
  kind: "assistant",
  text: "t",
  note: null,
  sessionName: "n",
  workspaceId: null,
  createdAt,
  state,
});

describe("bookmark helpers", () => {
  it("reads SQLite's zoneless time as UTC", () => {
    expect(createdAt(b("2026-10-14 09:30:00")).toISOString()).toBe(
      "2026-10-14T09:30:00.000Z"
    );
  });

  it("groups newest-first bookmarks by local day", () => {
    const now = new Date(2026, 9, 14, 18);
    const at = (d: Date) => d.toISOString();
    const groups = groupByDay(
      [
        b(at(new Date(2026, 9, 14, 12))),
        b(at(new Date(2026, 9, 14, 8))),
        b(at(new Date(2026, 9, 13, 23))),
        b(at(new Date(2026, 9, 9, 10))),
      ],
      now
    );
    expect(groups.map((g) => [g.day, g.bookmarks.length])).toEqual([
      ["Today", 2],
      ["Yesterday", 1],
      [
        new Date(2026, 9, 9).toLocaleDateString(undefined, {
          month: "short",
          day: "numeric",
        }),
        1,
      ],
    ]);
  });

  it("badges archived and deleted chats, and won't open a deleted one", () => {
    expect(STATE_BADGE.live).toBeNull();
    expect(STATE_BADGE.archived).toBe("archived");
    expect(STATE_BADGE.deleted).toBe("conversation deleted");
    expect(canOpen(b("x", "deleted"))).toBe(false);
    expect(canOpen(b("x", "archived"))).toBe(true);
  });

  it("flattens and clips an excerpt", () => {
    expect(excerpt("a\n\n  b")).toBe("a b");
    expect(excerpt("x".repeat(300), 10)).toBe("xxxxxxxxx…");
  });
});
