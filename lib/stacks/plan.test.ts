import { describe, expect, it } from "vitest";
import { planStack, StackCycleError, type PlanCard } from "./plan";

// The Workstak stack dispatch was built against: WOR-6 at the root, WOR-11
// blocked by WOR-10 AND WOR-7, WOR-13 by WOR-11 and WOR-12.
const GRAPH: Record<string, string[]> = {
  "WOR-6": [],
  "WOR-7": ["WOR-6"],
  "WOR-8": ["WOR-6"],
  "WOR-9": ["WOR-8"],
  "WOR-10": ["WOR-8"],
  "WOR-11": ["WOR-10", "WOR-7"],
  "WOR-12": ["WOR-8"],
  "WOR-13": ["WOR-11", "WOR-12"],
};

const card = (
  ticket: string,
  blockedBy: string[] = [],
  extra: Partial<PlanCard> = {}
): PlanCard => ({
  id: ticket,
  ticket,
  title: ticket,
  blockedBy,
  done: false,
  ...extra,
});

const graph = () => Object.entries(GRAPH).map(([t, b]) => card(t, b));
const by = (cards: PlanCard[]) =>
  Object.fromEntries(planStack(cards).map((i) => [i.cardId, i]));

describe("planStack", () => {
  it("sits each card on its deepest blocker", () => {
    const items = by(graph());
    expect(items["WOR-6"].parent).toBeNull();
    expect(items["WOR-9"].parent).toBe("WOR-8");
    // WOR-10 is on WOR-8 is on WOR-6, so it is deeper than WOR-7.
    expect(items["WOR-11"].parent).toBe("WOR-10");
    expect(items["WOR-11"].also).toEqual(["WOR-7"]);
    expect(items["WOR-13"].parent).toBe("WOR-11");
    expect(items["WOR-13"].also).toEqual(["WOR-12"]);
  });

  it("never orders a card before one of its blockers", () => {
    const order = planStack(graph()).map((i) => i.cardId);
    for (const [ticket, blockers] of Object.entries(GRAPH)) {
      for (const b of blockers) {
        expect(order.indexOf(b)).toBeLessThan(order.indexOf(ticket));
      }
    }
  });

  it("is independent of the order the board lists cards in", () => {
    const shuffled = graph().reverse();
    expect(planStack(shuffled).map((i) => i.cardId)).toEqual(
      planStack(graph()).map((i) => i.cardId)
    );
  });

  it("skips done cards, which stop blocking", () => {
    const items = by([
      card("WOR-6", [], { done: true }),
      card("WOR-7", ["WOR-6"]),
    ]);
    expect(items["WOR-6"].status).toBe("done");
    expect(items["WOR-7"].blockers).toEqual([]);
    expect(items["WOR-7"].parent).toBeNull();
    expect(items["WOR-7"].status).toBe("planned");
  });

  it("keeps a card that already has a task as running, not started again", () => {
    const items = by([
      card("WOR-6", [], { sessionId: "s-6" }),
      card("WOR-7", ["WOR-6"]),
    ]);
    expect(items["WOR-6"]).toMatchObject({
      status: "running",
      sessionId: "s-6",
    });
    expect(items["WOR-7"].parent).toBe("WOR-6");
  });

  it("holds everything on an excluded blocker", () => {
    const items = by([
      card("WOR-14", [], { excluded: "Cancelled" }),
      card("WOR-15", ["WOR-14"]),
      card("WOR-16", ["WOR-15"]),
    ]);
    expect(items["WOR-14"].status).toBe("excluded");
    expect(items["WOR-15"].status).toBe("held");
    expect(items["WOR-15"].note).toContain("WOR-14");
    expect(items["WOR-16"].status).toBe("held");
  });

  it("holds a card blocked by one outside the listing", () => {
    const items = by([card("WOR-1", ["other-board-card"])]);
    expect(items["WOR-1"].status).toBe("held");
  });

  it("refuses a cycle by name", () => {
    expect(() =>
      planStack([card("WOR-1", ["WOR-2"]), card("WOR-2", ["WOR-1"])])
    ).toThrow(StackCycleError);
    expect(() =>
      planStack([card("WOR-1", ["WOR-2"]), card("WOR-2", ["WOR-1"])])
    ).toThrow("cycle: WOR-1, WOR-2");
  });

  it("ignores a card blocking itself and duplicate blockers", () => {
    const items = by([
      card("WOR-1", ["WOR-1"]),
      card("WOR-2", ["WOR-1", "WOR-1"]),
    ]);
    expect(items["WOR-1"].blockers).toEqual([]);
    expect(items["WOR-2"].blockers).toEqual(["WOR-1"]);
  });

  it("gives each card its depth in the chain", () => {
    const items = by(graph());
    expect([
      items["WOR-6"].depth,
      items["WOR-8"].depth,
      items["WOR-13"].depth,
    ]).toEqual([0, 1, 4]);
  });
});
