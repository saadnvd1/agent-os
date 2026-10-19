import { describe, expect, it } from "vitest";
import { finishActions } from "./row-actions";

describe("finishActions", () => {
  it("gives a task Done and Archive", () => {
    expect(
      finishActions({ role: null, task_status: "running" }, false)
    ).toEqual(["done", "archive"]);
  });

  it("gives a task that is already done Restore instead of Done", () => {
    expect(finishActions({ role: null, task_status: "done" }, false)).toEqual([
      "restore",
      "archive",
    ]);
  });

  it("gives a plain session Archive (it is finished with Mark done)", () => {
    expect(finishActions({ role: null, task_status: null }, true)).toEqual([
      "archive",
    ]);
  });

  it("offers an orchestrator neither", () => {
    expect(
      finishActions({ role: "orchestrator", task_status: null }, true)
    ).toEqual([]);
  });

  it.each(["dropped", "done"] as const)("restores a %s task", (task_status) => {
    expect(finishActions({ role: null, task_status }, false)).toEqual([
      "restore",
      "archive",
    ]);
  });

  it.each(["merged", "moved"] as const)(
    "offers a %s task neither Done nor Restore",
    (task_status) => {
      expect(finishActions({ role: null, task_status }, false)).toEqual([
        "archive",
      ]);
    }
  );

  it("treats a task whose PR merged before the status caught up as ended", () => {
    expect(
      finishActions({ role: null, task_status: "running" }, false, "merged")
    ).toEqual(["archive"]);
  });
});
