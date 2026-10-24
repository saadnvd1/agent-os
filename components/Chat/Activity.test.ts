import { describe, expect, it } from "vitest";
import { currentActivity } from "./Activity";

describe("currentActivity while compacting", () => {
  it("says so, with the size going in and when it began", () => {
    expect(
      currentActivity([], "running", { since: 5, before: 182_000 })
    ).toMatchObject({
      label: "Compacting context… 182k tokens",
      since: 5,
      compacting: true,
    });
    expect(currentActivity([], "running", { since: 5 })?.label).toBe(
      "Compacting context…"
    );
  });

  it("is plain work without it, and nothing once the turn is over", () => {
    expect(currentActivity([], "running")?.compacting).toBeUndefined();
    expect(currentActivity([], "idle", { since: 5 })).toBeNull();
    expect(currentActivity([], "running")?.label).toBe("Waiting for the model");
  });
});
