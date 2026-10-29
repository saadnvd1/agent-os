import { describe, expect, it } from "vitest";
import {
  activePreset,
  clickRange,
  exchangeStarts,
  inRange,
  presetRange,
  rangeFromHere,
  rangeSummary,
  timeSpan,
  windowOf,
  type RangeRow,
} from "./range";

const at = (h: number, m = 0, day = 29) =>
  new Date(2026, 9, day, h, m).getTime();
const NOW = new Date(2026, 9, 29, 15, 0);

// 3 exchanges; the first started yesterday, two today. Tool rows don't count.
const rows: RangeRow[] = [
  { id: "n0", type: "divider", createdAt: at(9, 0, 28) },
  { id: "u1", type: "user", createdAt: at(9, 1, 28) },
  { id: "t1", type: "detail", createdAt: at(9, 2, 28) },
  { id: "a1", type: "assistant", createdAt: at(9, 3, 28) },
  { id: "u2", type: "user", createdAt: at(14, 14) },
  { id: "t2", type: "detail", createdAt: at(14, 15) },
  { id: "t3", type: "detail", createdAt: at(14, 16) },
  { id: "a2", type: "assistant", createdAt: at(14, 20) },
  { id: "u3", type: "user", createdAt: at(14, 30) },
  { id: "a3", type: "assistant", createdAt: at(14, 40) },
];

describe("windowOf", () => {
  const ids = ["a", "b", "c", "d"];
  it("resolves ends, open ends and bad ones", () => {
    expect(windowOf(ids, "b", "c")).toEqual({ start: 1, end: 2 });
    expect(windowOf(ids, "c")).toEqual({ start: 2, end: 3 });
    expect(windowOf(ids, undefined, "b")).toEqual({ start: 0, end: 1 });
    expect(windowOf(ids, "x", "c")).toBeNull();
    expect(windowOf(ids, "d", "a")).toBeNull();
  });
});

describe("exchangeStarts", () => {
  it("starts at each user prompt, and counts leading rows as one exchange", () => {
    expect(exchangeStarts(rows)).toEqual([0, 1, 4, 8]);
    expect(exchangeStarts(rows.slice(1))).toEqual([0, 3, 7]);
    expect(exchangeStarts([])).toEqual([]);
  });
});

describe("presetRange", () => {
  it("last exchange is the last prompt and everything after it", () => {
    expect(presetRange(rows, "last", NOW)).toEqual({
      fromId: "u3",
      toId: "a3",
    });
  });

  it("counts exchanges, not rows", () => {
    expect(presetRange(rows, "last5", NOW)).toEqual({
      fromId: "n0",
      toId: "a3",
    });
    expect(presetRange(rows.slice(1), "last5", NOW)?.fromId).toBe("u1");
    const many = Array.from({ length: 7 }, (_, i) => [
      { id: `u${i}`, type: "user" },
      { id: `t${i}`, type: "detail" },
      { id: `t${i}b`, type: "detail" },
      { id: `a${i}`, type: "assistant" },
    ]).flat();
    expect(presetRange(many, "last5", NOW)).toEqual({
      fromId: "u2",
      toId: "a6",
    });
  });

  it("today starts at the first prompt written today", () => {
    expect(presetRange(rows, "today", NOW)).toEqual({
      fromId: "u2",
      toId: "a3",
    });
  });

  it("today is empty when nothing was said today", () => {
    expect(presetRange(rows, "today", new Date(2026, 10, 2))).toBeNull();
  });

  it("whole chat and an empty chat", () => {
    expect(presetRange(rows, "all", NOW)).toEqual({ fromId: "n0", toId: "a3" });
    expect(presetRange([], "last", NOW)).toBeNull();
  });

  it("a chat with no prompt shares all of it as the last exchange", () => {
    const r = [
      { id: "a", type: "assistant" },
      { id: "b", type: "assistant" },
    ];
    expect(presetRange(r, "last", NOW)).toEqual({ fromId: "a", toId: "b" });
  });
});

describe("activePreset", () => {
  it("names the preset a range equals, or none for a custom one", () => {
    const last = presetRange(rows, "last", NOW);
    expect(activePreset(rows, last, NOW)).toBe("last");
    expect(activePreset(rows, { fromId: "a2", toId: "a3" }, NOW)).toBeNull();
    expect(activePreset(rows, null, NOW)).toBeNull();
  });
});

describe("rangeFromHere", () => {
  it("runs from the message to the latest", () => {
    expect(rangeFromHere(rows, "u2")).toEqual({ fromId: "u2", toId: "a3" });
    expect(rangeFromHere(rows, "nope")).toBeNull();
  });
});

describe("clickRange", () => {
  it("a click picks one message", () => {
    expect(clickRange(rows, "u1", "u2", false)).toEqual({
      fromId: "u2",
      toId: "u2",
    });
  });

  it("a shift-click stretches from the anchor, either way", () => {
    expect(clickRange(rows, "u2", "a2", true)).toEqual({
      fromId: "u2",
      toId: "a2",
    });
    expect(clickRange(rows, "a2", "u2", true)).toEqual({
      fromId: "u2",
      toId: "a2",
    });
  });

  it("a shift-click with no anchor acts as a click", () => {
    expect(clickRange(rows, null, "u2", true)).toEqual({
      fromId: "u2",
      toId: "u2",
    });
  });
});

describe("inRange", () => {
  it("slices the rows, all when there is no range, none when it's gone", () => {
    expect(
      inRange(rows, { fromId: "u2", toId: "t3" }).map((r) => r.id)
    ).toEqual(["u2", "t2", "t3"]);
    expect(inRange(rows, null)).toHaveLength(rows.length);
    expect(inRange(rows, { fromId: "zz", toId: "a3" })).toEqual([]);
  });
});

describe("time labels", () => {
  it("formats in 12-hour time, sharing the am/pm when it matches", () => {
    expect(timeSpan(at(14, 14), at(14, 40))).toBe("2:14–2:40 PM");
    expect(timeSpan(at(11, 50), at(12, 10))).toBe("11:50 AM–12:10 PM");
    expect(timeSpan(at(0, 5), at(0, 5))).toBe("12:05 AM");
  });

  it("names the days when it crosses midnight", () => {
    expect(timeSpan(at(23, 50, 28), at(0, 10, 29))).toBe(
      "Oct 28, 11:50 PM – Oct 29, 12:10 AM"
    );
  });

  it("summarises the range", () => {
    const shared = rows.slice(4, 8);
    expect(rangeSummary(120, shared)).toBe(
      "Sharing 4 of 120 messages · 2:14–2:20 PM"
    );
    expect(rangeSummary(1, [rows[0]])).toMatch(/^Sharing 1 of 1 message ·/);
    expect(rangeSummary(5, [])).toBe("Nothing selected to share");
  });
});
