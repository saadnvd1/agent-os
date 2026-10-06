import { describe, expect, it } from "vitest";
import type { StackItemRow, StackItemStatus } from "../db";
import { planTick, waitingOn } from "./ready";
import { refusalFor } from "./guard";
import { itemsFromPlan } from "./create";
import { planStack } from "./plan";
import { toPlanCards } from "./board";

const row = (
  id: string,
  status: StackItemStatus,
  blockers: string[] = [],
  extra: Partial<StackItemRow> = {}
): StackItemRow => ({
  id,
  stack_id: "s",
  position: 0,
  lh_card_id: `card-${id}`,
  ticket: id,
  title: id,
  parent_item_id: blockers[0] ?? null,
  also_item_ids: "[]",
  blocker_item_ids: JSON.stringify(blockers),
  status,
  session_id: null,
  base_branch: null,
  base_tip: null,
  pr_number: null,
  note: null,
  error: null,
  ...extra,
});

describe("planTick", () => {
  it("starts roots, and children only once the parent has a PR", () => {
    const items = [row("A", "planned"), row("B", "planned", ["A"])];
    expect(planTick(items, 3).start).toEqual(["A"]);
    const later = [row("A", "running"), row("B", "planned", ["A"])];
    expect(planTick(later, 3).start).toEqual([]);
    const up = [row("A", "pr"), row("B", "planned", ["A"])];
    expect(planTick(up, 3).start).toEqual(["B"]);
  });

  it("waits for every blocker and says which PR is missing", () => {
    const byId = new Map(
      [
        row("A", "pr"),
        row("C", "running"),
        row("B", "planned", ["A", "C"]),
      ].map((r) => [r.id, r])
    );
    expect(waitingOn(byId.get("B")!, byId)).toBe("Waits on C's PR");
    expect(planTick([...byId.values()], 3).start).toEqual([]);
  });

  it("starts no more than max items without a PR, counting running ones", () => {
    const items = [
      row("R", "running"),
      ...["A", "B", "C", "D"].map((k) => row(k, "planned")),
    ];
    expect(planTick(items, 3).start).toEqual(["A", "B"]);
  });

  it("holds what sits on a failed, dropped or held item, and its dependents", () => {
    const items = [
      row("A", "failed"),
      row("B", "planned", ["A"]),
      row("C", "planned", ["B"]),
      row("D", "planned"),
    ];
    const plan = planTick(items, 3);
    expect(plan.hold.map((h) => h.id)).toEqual(["B", "C"]);
    expect(plan.hold[0].note).toContain("A is failed");
    expect(plan.start).toEqual(["D"]);
  });

  it("treats a merged blocker as ready", () => {
    expect(
      planTick([row("A", "merged"), row("B", "planned", ["A"])], 1).start
    ).toEqual(["B"]);
  });
});

describe("sign-off refusal", () => {
  const parent = row("P", "pr");
  const child = row("C", "pr", ["P"], { base_branch: "feature/p" });

  it("refuses a child whose parent has not merged, by name", () => {
    expect(refusalFor(child, parent, "feature/p")).toBe(
      "C is stacked on P, which has not merged. A stack merges bottom-up: sign off P first."
    );
    expect(
      refusalFor(child, { ...parent, status: "dropped" }, "feature/p")
    ).toContain("which is dropped");
  });

  it("refuses a child left on a merged parent's branch, with the fix", () => {
    const stuck = {
      ...child,
      error: "Resolve it with `git rebase --onto origin/main abc`",
    };
    expect(
      refusalFor(stuck, { ...parent, status: "merged" }, "feature/p")
    ).toMatch(/never moved off its branch\. Resolve it with `git rebase/);
  });

  it("allows a restacked child, and anything not stacked", () => {
    const moved = { ...child, base_branch: "main" };
    expect(
      refusalFor(moved, { ...parent, status: "merged" }, "feature/p")
    ).toBeNull();
    expect(refusalFor(row("X", "pr"), null, null)).toBeNull();
  });
});

describe("board to stack rows", () => {
  it("reads done, cancelled and backlog lists, and running tasks", () => {
    const lists = [
      {
        id: "todo",
        board_id: "b",
        name: "To Do",
        position: 0,
        category: "unstarted" as const,
      },
      {
        id: "done",
        board_id: "b",
        name: "Done",
        position: 1,
        category: "completed" as const,
      },
      {
        id: "x",
        board_id: "b",
        name: "Won't do",
        position: 2,
        category: "canceled" as const,
      },
      {
        id: "later",
        board_id: "b",
        name: "Backlog",
        position: 3,
        category: "backlog" as const,
      },
    ];
    const card = (id: string, list_id: string, blocked: string[] = []) => ({
      id,
      ticket: id,
      board_id: "b",
      list_id,
      list_name: null,
      title: id,
      description: null,
      position: 0,
      blocked_by: blocked.map((b) => ({ id: b, ticket: b })),
    });
    const cards = toPlanCards(
      [
        card("1", "done"),
        card("2", "todo", ["1"]),
        card("3", "x"),
        card("4", "later"),
        card("5", "todo"),
      ],
      lists,
      new Map([["5", "session-5"]])
    );
    expect(cards.map((c) => [c.done, c.excluded, c.sessionId])).toEqual([
      [true, null, null],
      [false, null, null],
      [false, "Cancelled", null],
      [false, "In the backlog", null],
      [false, null, "session-5"],
    ]);
    expect(cards[1].blockedBy).toEqual(["1"]);
  });

  it("stores planned, held and running items with their links as item ids", () => {
    let n = 0;
    const plan = planStack([
      { id: "a", ticket: "E-1", title: "a", blockedBy: [], done: false },
      { id: "b", ticket: "E-2", title: "b", blockedBy: ["a"], done: false },
      {
        id: "c",
        ticket: "E-3",
        title: "c",
        blockedBy: ["a", "b"],
        done: false,
      },
      { id: "d", ticket: "E-4", title: "d", blockedBy: [], done: true },
    ]);
    const rows = itemsFromPlan(plan, () => `i${++n}`);
    expect(rows.map((r) => r.lh_card_id)).toEqual(["a", "b", "c"]);
    expect(rows[2]).toMatchObject({
      parent_item_id: "i2",
      blocker_item_ids: JSON.stringify(["i1", "i2"]),
      also_item_ids: "[]",
      status: "planned",
    });
  });
});
