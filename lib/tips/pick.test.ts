import { describe, expect, it } from "vitest";
import { orderDeck, pickToday } from "./pick";

const deck = [{ id: "a" }, { id: "b" }, { id: "c" }];

describe("orderDeck", () => {
  it("puts the newest first and keeps file order within a day", () => {
    const ids = orderDeck([
      { id: "x", added: "2026-01-01" },
      { id: "y", added: "2026-02-01" },
      { id: "z", added: "2026-01-01" },
    ]).map((t) => t.id);
    expect(ids).toEqual(["y", "x", "z"]);
  });
});

describe("pickToday", () => {
  it("takes the first tip not yet seen", () => {
    expect(
      pickToday({ deck, seen: { a: "d0" }, pinned: null, day: "d1" })
    ).toEqual({ day: "d1", id: "b", read: false });
  });

  it("keeps today's tip all day, even after others are seen", () => {
    const pinned = { day: "d1", id: "b", read: true };
    expect(
      pickToday({ deck, seen: { a: "d1", b: "d1" }, pinned, day: "d1" })
    ).toBe(pinned);
  });

  it("moves on the next day", () => {
    const pinned = { day: "d1", id: "a", read: true };
    expect(pickToday({ deck, seen: { a: "d1" }, pinned, day: "d2" })?.id).toBe(
      "b"
    );
  });

  it("replaces a pinned tip that no longer applies", () => {
    const pinned = { day: "d1", id: "gone", read: false };
    expect(pickToday({ deck, seen: {}, pinned, day: "d1" })?.id).toBe("a");
  });

  it("cycles to the tip seen longest ago once all are seen", () => {
    const seen = { a: "2026-03-02", b: "2026-03-01", c: "2026-03-03" };
    expect(pickToday({ deck, seen, pinned: null, day: "2026-03-04" })?.id).toBe(
      "b"
    );
  });

  it("returns null for an empty deck", () => {
    expect(
      pickToday({ deck: [], seen: {}, pinned: null, day: "d1" })
    ).toBeNull();
  });
});
