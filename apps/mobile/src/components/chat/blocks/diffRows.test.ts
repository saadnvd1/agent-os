import { describe, expect, it } from "vitest";
import { lineDiff } from "@/lib/chat/diff";
import { diffRows, numberLines, unfold } from "./diffRows";

const before = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join("\n");
const after = before.replace("line 10", "LINE TEN");

describe("numberLines", () => {
  it("counts old and new lines separately", () => {
    const rows = numberLines(lineDiff("a\nb\nc", "a\nB\nc\nd"));
    expect(rows.map((r) => [r.op, r.old, r.new])).toEqual([
      [" ", 1, 1],
      ["-", 2, null],
      ["+", null, 2],
      [" ", 3, 3],
      ["+", null, 4],
    ]);
  });
});

describe("diffRows", () => {
  it("keeps three lines of context around a change and folds the rest", () => {
    const rows = diffRows(lineDiff(before, after));
    expect(rows[0]).toEqual({ kind: "fold", count: 6, from: 0 });
    const lines = rows.filter((r) => r.kind === "line");
    expect(
      lines.map((r) => (r.kind === "line" ? (r.old ?? r.new) : 0))
    ).toEqual([7, 8, 9, 10, 10, 11, 12, 13]);
    expect(rows[rows.length - 1]).toEqual({ kind: "fold", count: 7, from: 14 });
  });

  it("doesn't fold a new file", () => {
    const rows = diffRows(lineDiff("", "a\nb\nc\nd\ne\nf\ng\nh"));
    expect(rows.every((r) => r.kind === "line" && r.op === "+")).toBe(true);
  });

  it("unfolds a run back into numbered lines", () => {
    const lines = lineDiff(before, after);
    expect(unfold(lines, 0, 2)).toEqual([
      { kind: "line", op: " ", text: "line 1", old: 1, new: 1 },
      { kind: "line", op: " ", text: "line 2", old: 2, new: 2 },
    ]);
  });
});
