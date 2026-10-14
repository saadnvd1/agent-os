import { describe, expect, it } from "vitest";
import { StartGate } from "./start-gate";
import { LOAD_SETTLE_MS } from "@/lib/tasks/schedule";

describe("StartGate", () => {
  it("is closed before the first sample", () => {
    const g = new StartGate();
    expect(g.view(0, null)).toMatchObject({ reading: true, settled: false });
  });

  it("opens at once for a machine that has never been red", () => {
    const g = new StartGate();
    expect(g.feed("green", 1000)).toBe(true);
    expect(g.view(1000, "green")).toMatchObject({
      reading: false,
      settled: true,
    });
  });

  it("closes on red and reopens only after the settle time without red", () => {
    const g = new StartGate();
    g.feed("green", 0);
    g.feed("red", 10_000);
    expect(g.view(10_000, "red").settled).toBe(false);
    g.feed("green", 20_000);
    expect(g.view(20_000, "green")).toMatchObject({
      settled: false,
      settleLeftMs: LOAD_SETTLE_MS - 10_000,
    });
    expect(g.view(10_000 + LOAD_SETTLE_MS - 1, "green").settled).toBe(false);
    expect(g.view(10_000 + LOAD_SETTLE_MS, "green").settled).toBe(true);
  });

  it("a red inside the settle time starts the wait again", () => {
    const g = new StartGate();
    g.feed("red", 0);
    g.feed("amber", 60_000);
    g.feed("red", 90_000);
    expect(g.view(90_000 + LOAD_SETTLE_MS - 1, "green").settled).toBe(false);
    expect(g.view(90_000 + LOAD_SETTLE_MS, "green").settled).toBe(true);
  });

  it("amber doesn't close an open gate", () => {
    const g = new StartGate();
    g.feed("green", 0);
    g.feed("amber", 5000);
    expect(g.view(5000, "amber").settled).toBe(true);
  });
});
