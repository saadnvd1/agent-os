import { describe, it, expect, vi } from "vitest";
import type { LumifyHubClient } from "./client";
import type { LhList } from "./types";
import {
  cardTargetFor,
  ensureTaskLists,
  findList,
  orderWithTaskLists,
} from "./lists";

const list = (id: string, name: string, position: number): LhList => ({
  id,
  board_id: "b",
  name,
  position,
  category: "unstarted",
});

describe("task state → list", () => {
  it("follows the contract table", () => {
    expect(cardTargetFor("queued")).toBe("todo");
    expect(cardTargetFor("working")).toBe("in_progress");
    expect(cardTargetFor("needs-input")).toBe("in_progress");
    expect(cardTargetFor("blocked")).toBe("in_progress");
    expect(cardTargetFor("review")).toBe("in_review");
    expect(cardTargetFor("checks-failing")).toBe("in_review");
    expect(cardTargetFor("merged")).toBe("done");
    expect(cardTargetFor("dropped")).toBe("dropped");
    expect(cardTargetFor("exited")).toBe("failed");
  });
});

describe("list names", () => {
  const lists = [list("1", "TO DO", 0), list("2", " in  progress ", 1)];
  it("match case- and space-insensitively", () => {
    expect(findList(lists, "To Do")?.id).toBe("1");
    expect(findList(lists, "In Progress")?.id).toBe("2");
    expect(findList(lists, "Done")).toBeUndefined();
  });

  it("slot a created In Review after In Progress", () => {
    const all = [
      list("todo", "To Do", 0),
      list("prog", "In Progress", 1),
      list("done", "Done", 2),
      list("rev", "In Review", 3),
    ];
    expect(orderWithTaskLists(all, new Set(["rev"]))).toEqual([
      "todo",
      "prog",
      "rev",
      "done",
    ]);
  });
});

describe("ensureTaskLists", () => {
  it("reuses existing lists and creates only the missing one", async () => {
    const existing = [
      list("todo", "to do", 0),
      list("prog", "In Progress", 1),
      { ...list("done", "Done", 2), category: "completed" as const },
    ];
    const client = {
      listLists: vi.fn().mockResolvedValue(existing),
      createList: vi.fn().mockResolvedValue(list("rev", "In Review", 3)),
      updateList: vi.fn().mockResolvedValue({}),
    };
    const ids = await ensureTaskLists(
      client as unknown as LumifyHubClient,
      "board-1",
      true
    );
    expect(ids).toEqual({
      todo: "todo",
      in_progress: "prog",
      in_review: "rev",
      done: "done",
    });
    expect(client.createList).toHaveBeenCalledTimes(1);
    expect(client.createList).toHaveBeenCalledWith("board-1", {
      name: "In Review",
      category: "started",
    });
    // In Review moves to 2, Done to 3
    expect(client.updateList.mock.calls).toEqual([
      ["board-1", "rev", { position: 2 }],
      ["board-1", "done", { position: 3 }],
    ]);
  });

  it("shares one load between concurrent callers", async () => {
    let n = 0;
    const client = {
      listLists: vi.fn().mockImplementation(async () => []),
      createList: vi
        .fn()
        .mockImplementation(async (_b: string, input: { name: string }) =>
          list(`l${n++}`, input.name, n)
        ),
      updateList: vi.fn().mockResolvedValue({}),
    };
    const c = client as unknown as LumifyHubClient;
    const [a, b] = await Promise.all([
      ensureTaskLists(c, "board-2"),
      ensureTaskLists(c, "board-2"),
    ]);
    expect(a).toEqual(b);
    expect(client.listLists).toHaveBeenCalledTimes(1);
    expect(client.createList).toHaveBeenCalledTimes(4);
    expect(client.createList.mock.calls.map((c) => c[1].name)).toEqual([
      "To Do",
      "In Progress",
      "In Review",
      "Done",
    ]);
  });
});
