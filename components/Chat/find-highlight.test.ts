import { JSDOM } from "jsdom";
import { describe, expect, it, vi } from "vitest";
import { findRanges, matchSpans } from "./find-highlight";
import { RowStore } from "./rowState";

// The suite's setup needs node, so the DOM is built here.
const { window } = new JSDOM("<!doctype html><body></body>");
const { document } = window;

describe("matchSpans", () => {
  it("finds a match split across pieces", () => {
    expect(matchSpans(["const ", "fo", "o = 1"], "foo =")).toEqual([
      { start: [1, 0], end: [2, 3] },
    ]);
  });

  it("ends a match at the close of its piece, not the start of the next", () => {
    expect(matchSpans(["ab", "cd"], "ab")).toEqual([
      { start: [0, 0], end: [0, 2] },
    ]);
  });
});

describe("findRanges", () => {
  it("covers markdown and a highlighted code block without touching them", () => {
    document.body.innerHTML = `
      <div id="root">
        <p>Run <strong>npm</strong> test, then <code>npm run lint</code></p>
        <pre><span class="k">npm</span><span> </span><span>ci</span></pre>
      </div>`;
    const root = document.getElementById("root")!;
    const before = root.innerHTML;
    const ranges = findRanges(root, "NPM");
    expect(ranges.map((r) => r.toString())).toEqual(["npm", "npm", "npm"]);
    expect(findRanges(root, "npm ci").map((r) => r.toString())).toEqual([
      "npm ci",
    ]);
    expect(root.innerHTML).toBe(before);
  });
});

describe("RowStore", () => {
  it("tells an open row when find opens it from outside", () => {
    const rows = new RowStore();
    const heard = vi.fn();
    const stop = rows.subscribe("steps:t1", heard);
    rows.set("steps:t1", true);
    rows.set("steps:t1", true);
    rows.set("tool:t2", true);
    expect(heard).toHaveBeenCalledTimes(1);
    expect(rows.get("steps:t1")).toBe(true);
    stop();
    rows.set("steps:t1", false);
    expect(heard).toHaveBeenCalledTimes(1);
  });
});
