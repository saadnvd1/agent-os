import { describe, expect, it } from "vitest";
import { anchorOf, decideOpen } from "./position";

const rows = [
  { key: "a", top: -300, bottom: -100 },
  { key: "b", top: -100, bottom: 120 },
  { key: "c", top: 120, bottom: 400 },
];

describe("anchorOf", () => {
  it("is the first row whose bottom is below the top, with its offset", () => {
    expect(anchorOf(0, rows, false)).toEqual({
      block: "b",
      offsetPx: -100,
      atEnd: false,
    });
  });
  it("follows the latest when the reader is at the end, or nothing is in view", () => {
    expect(anchorOf(0, rows, true).atEnd).toBe(true);
    expect(anchorOf(0, [], false).atEnd).toBe(true);
    expect(anchorOf(900, rows, false).atEnd).toBe(true);
  });
});

describe("decideOpen", () => {
  const items = [
    { id: "i1", createdAt: 100 },
    { id: "i2", createdAt: 200 },
    { id: "i3", createdAt: 300 },
  ];
  const left = (o: object = {}) => ({
    itemId: "i1",
    offsetPx: 30,
    atEnd: false,
    viewedAt: 300,
    ...o,
  });

  it("opens at the first new item when there is anything new", () => {
    expect(
      decideOpen({ view: left({ viewedAt: 150 }), items, latest: false })
    ).toEqual({ kind: "new", itemId: "i2", hasBefore: true });
  });
  it("opens at the first new item even when the reader had left it at the end", () => {
    expect(
      decideOpen({
        view: left({ viewedAt: 250, atEnd: true, itemId: null }),
        items,
        latest: false,
      })
    ).toMatchObject({ kind: "new", itemId: "i3" });
  });
  it("says there is nothing before it when the whole chat is new", () => {
    expect(
      decideOpen({ view: left({ viewedAt: 1 }), items, latest: false })
    ).toEqual({ kind: "new", itemId: "i1", hasBefore: false });
  });
  it("restores the saved position when nothing is new", () => {
    expect(decideOpen({ view: left(), items, latest: false })).toEqual({
      kind: "position",
      block: "i1",
      offsetPx: 30,
    });
  });
  it("opens at the latest when never opened", () => {
    expect(decideOpen({ view: null, items, latest: false })).toEqual({
      kind: "latest",
    });
  });
  it("opens at the latest when it was left at the end and nothing is new", () => {
    expect(
      decideOpen({
        view: left({ atEnd: true, itemId: null }),
        items,
        latest: false,
      })
    ).toEqual({ kind: "latest" });
  });
  it("opens at the latest from a notification, Needs you or the Inbox, new items or not", () => {
    expect(
      decideOpen({ view: left({ viewedAt: 150 }), items, latest: true })
    ).toEqual({ kind: "latest" });
  });
});
