import { describe, expect, it } from "vitest";
import { docRows, docTree, isMarkdownPath, matchesQuery } from "./doc-tree";
import type { DocSummary } from "./types";

const doc = (id: string, parentId: string | null = null): DocSummary => ({
  id,
  title: `Page ${id}`,
  parentId,
  updatedAt: "2026-10-05T12:00:00Z",
});

describe("docTree", () => {
  it("puts children under their parent, in order", () => {
    const rows = docTree([doc("b", "a"), doc("a"), doc("c"), doc("d", "b")]);
    expect(rows.map((r) => [r.doc.id, r.depth])).toEqual([
      ["a", 0],
      ["b", 1],
      ["d", 2],
      ["c", 0],
    ]);
  });

  it("treats a page whose parent isn't listed as a root", () => {
    expect(docTree([doc("x", "board-page")])).toEqual([
      { doc: doc("x", "board-page"), depth: 0 },
    ]);
  });

  it("still shows pages caught in a parent loop", () => {
    const rows = docTree([doc("a", "b"), doc("b", "a")]);
    expect(rows.map((r) => r.doc.id).sort()).toEqual(["a", "b"]);
  });
});

describe("search", () => {
  it("matches every word, case-insensitively", () => {
    expect(matchesQuery("Launch Plan Q4", "plan q4")).toBe(true);
    expect(matchesQuery("Launch Plan", "plan q4")).toBe(false);
  });

  it("flattens the tree while searching", () => {
    const rows = docRows([doc("a"), doc("b", "a")], "page b");
    expect(rows).toEqual([{ doc: doc("b", "a"), depth: 0 }]);
  });
});

it("recognises markdown files", () => {
  expect(isMarkdownPath("/r/docs/PLAN.md")).toBe(true);
  expect(isMarkdownPath("/r/notes.markdown")).toBe(true);
  expect(isMarkdownPath("/r/app.tsx")).toBe(false);
});
