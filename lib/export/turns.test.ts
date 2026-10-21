import { describe, expect, it } from "vitest";
import { groupTurns, resolveRange, inRange } from "./turns";
import { item } from "./fixtures";

const user = (midTurn = false) => item({ kind: "user", text: "q", midTurn });
const reply = () => item({ kind: "assistant", text: "a" });

describe("groupTurns", () => {
  it("starts a turn at each user message and keeps order", () => {
    const turns = groupTurns([user(), reply(), user(), reply()]);
    expect(turns.map((t) => [t.n, t.items.length])).toEqual([
      [1, 2],
      [2, 2],
    ]);
  });

  it("keeps a message sent mid-turn inside its turn", () => {
    const turns = groupTurns([user(), reply(), user(true), reply(), user()]);
    expect(turns.map((t) => t.items.length)).toEqual([4, 1]);
  });

  it("puts what came before the first message in turn 0", () => {
    const turns = groupTurns([reply(), user(), reply()]);
    expect(turns.map((t) => t.n)).toEqual([0, 1]);
  });
});

describe("resolveRange", () => {
  const five = groupTurns(
    Array.from({ length: 5 }, () => [user(), reply()]).flat()
  );

  it("is the whole session without a range", () => {
    expect(resolveRange(five, undefined)).toEqual({ from: 1, to: 5, of: 5 });
  });

  it("takes the last k turns, clamped", () => {
    expect(resolveRange(five, { last: 2 })).toEqual({ from: 4, to: 5, of: 5 });
    expect(resolveRange(five, { last: 99 }).from).toBe(1);
  });

  it("starts at the turn holding the last compaction", () => {
    const turns = groupTurns([
      user(),
      reply(),
      user(),
      item({ kind: "compacted" }),
      user(),
      reply(),
    ]);
    expect(resolveRange(turns, { sinceCompaction: true }).from).toBe(2);
  });

  it("clamps the end and rejects a bad start", () => {
    expect(resolveRange(five, { from: 2, to: 99 })).toEqual({
      from: 2,
      to: 5,
      of: 5,
    });
    expect(() => resolveRange(five, { from: 9, to: 10 })).toThrow(
      /starts at turn 9/
    );
    expect(() => resolveRange(five, { from: 4, to: 2 })).toThrow(
      /before it starts/
    );
  });

  it("includes turn 0 only when the range starts at the beginning", () => {
    expect(inRange(0, { from: 1, to: 3 })).toBe(true);
    expect(inRange(0, { from: 2, to: 3 })).toBe(false);
  });
});
