import { describe, expect, it } from "vitest";
import { finishActions } from "./row-actions";

describe("finishActions", () => {
  it("gives a task Done and Archive", () => {
    expect(
      finishActions({ role: null, task_status: "running" }, false)
    ).toEqual(["done", "archive"]);
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
});
