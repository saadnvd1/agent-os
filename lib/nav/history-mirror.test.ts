import { describe, expect, it } from "vitest";
import {
  earlier,
  emptyMirror,
  later,
  moveTo,
  renameIn,
  visit,
} from "./history-mirror";

const e = (index: number, sessionId = "s" + index) => ({
  index,
  sessionId,
  name: "chat " + sessionId,
});

describe("history mirror", () => {
  it("lists what is behind and ahead of the current entry", () => {
    let m = visit(emptyMirror(), e(0), "replace");
    m = visit(m, e(1), "push");
    m = visit(m, e(2), "push");
    expect(earlier(m).map((x) => x.index)).toEqual([1, 0]);
    expect(later(m)).toEqual([]);
    m = moveTo(m, 0);
    expect(earlier(m)).toEqual([]);
    expect(later(m).map((x) => x.index)).toEqual([1, 2]);
  });

  it("drops the forward entries on a push, as the browser does", () => {
    let m = visit(emptyMirror(), e(0), "replace");
    m = visit(m, e(1), "push");
    m = visit(m, e(2), "push");
    m = moveTo(m, 0);
    m = visit(m, e(1, "other"), "push");
    expect(m.entries.map((x) => x.sessionId)).toEqual(["s0", "other"]);
    expect(later(m)).toEqual([]);
  });

  it("replaces an entry in place and ignores a move to one it never saw", () => {
    let m = visit(emptyMirror(), e(0), "replace");
    m = visit(m, e(1), "push");
    m = visit(m, { ...e(1), name: "renamed" }, "replace");
    expect(m.entries).toHaveLength(2);
    expect(m.entries[1].name).toBe("renamed");
    expect(moveTo(m, 9)).toBe(m);
  });

  it("renames a chat everywhere it appears", () => {
    let m = visit(emptyMirror(), e(0, "a"), "replace");
    m = visit(m, e(1, "b"), "push");
    m = visit(m, e(2, "a"), "push");
    expect(renameIn(m, "a", "new").entries.map((x) => x.name)).toEqual([
      "new",
      "chat b",
      "new",
    ]);
  });
});
