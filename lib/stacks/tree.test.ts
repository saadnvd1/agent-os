import { describe, expect, it } from "vitest";
import { treeOrder } from "./tree";

describe("treeOrder", () => {
  it("puts each item right under its parent, keeping plan order among siblings", () => {
    const items = [
      { id: "6", parentId: null },
      { id: "7", parentId: "6" },
      { id: "8", parentId: "6" },
      { id: "9", parentId: "8" },
      { id: "11", parentId: "7" },
      { id: "x", parentId: "gone" },
    ];
    expect(treeOrder(items).map((i) => i.id)).toEqual([
      "6",
      "7",
      "11",
      "8",
      "9",
      "x",
    ]);
  });
});
