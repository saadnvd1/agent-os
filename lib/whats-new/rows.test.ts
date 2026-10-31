import { describe, expect, it } from "vitest";
import { buildRows, dayLabel } from "./rows";
import type { Entry } from "./schema";

const e = (id: number, date: string): Entry => ({
  id,
  date,
  kind: "new",
  area: "Chat",
  text: `T${id}.`,
});
const now = new Date(2026, 9, 30);

describe("dayLabel", () => {
  it("names today and yesterday, then dates", () => {
    expect(dayLabel("2026-10-30", now)).toBe("Today");
    expect(dayLabel("2026-10-29", now)).toBe("Yesterday");
    expect(dayLabel("2026-10-27", now)).toBe("Oct 27");
    expect(dayLabel("2025-12-01", now)).toBe("Dec 1, 2025");
  });
});

describe("buildRows", () => {
  const list = [
    e(5, "2026-10-30"),
    e(4, "2026-10-29"),
    e(3, "2026-10-29"),
    e(2, "2026-10-27"),
  ];
  const shape = (seen: number | null) =>
    buildRows(list, seen, now).map((r) =>
      r.type === "entry" ? r.entry.id : r.type === "day" ? r.label : r.label
    );

  it("puts a divider where the last visit ended", () => {
    expect(shape(3)).toEqual([
      "Today",
      5,
      "Yesterday",
      4,
      "You last looked Yesterday",
      "Yesterday",
      3,
      "Oct 27",
      2,
    ]);
  });

  it("has no divider when nothing is unread or nothing is known", () => {
    expect(shape(5).some((x) => String(x).startsWith("You last"))).toBe(false);
    expect(shape(null).some((x) => String(x).startsWith("You last"))).toBe(
      false
    );
  });
});
