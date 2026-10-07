import { describe, expect, it } from "vitest";
import { meterLevel, toChatContext, turnDelta, usageTotals } from "./context";

const totals = (costUsd: number, inputTokens: number) => ({
  costUsd,
  inputTokens,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
});

describe("meterLevel", () => {
  it("turns amber past 60% and red past 85%", () => {
    expect(meterLevel(0)).toBe("ok");
    expect(meterLevel(59)).toBe("ok");
    expect(meterLevel(60)).toBe("warn");
    expect(meterLevel(84)).toBe("warn");
    expect(meterLevel(85)).toBe("high");
    expect(meterLevel(130)).toBe("high");
  });
});

describe("toChatContext", () => {
  it("measures against the room left before auto-compact", () => {
    const c = toChatContext(
      {
        totalTokens: 50_000,
        maxTokens: 1_000_000,
        percentage: 5,
        categories: [
          { name: "Messages", tokens: 40_000, kind: "used" },
          { name: "System tools", tokens: 10_000, kind: "used" },
          { name: "MCP tools (deferred)", tokens: 90_000, kind: "deferred" },
          { name: "Autocompact buffer", tokens: 800_000, kind: "buffer" },
          { name: "Free space", tokens: 150_000, kind: "free" },
        ],
      },
      7
    );
    expect(c.maxTokens).toBe(200_000);
    expect(c.percentage).toBe(25);
    expect(c.categories.map((x) => x.name)).toEqual([
      "Messages",
      "System tools",
    ]);
    expect(c.at).toBe(7);
  });

  it("uses the whole window when there's no compaction reserve", () => {
    const c = toChatContext({
      totalTokens: 100,
      maxTokens: 200,
      percentage: 50,
      categories: [],
    });
    expect(c).toMatchObject({ maxTokens: 200, percentage: 50 });
  });
});

describe("usageTotals", () => {
  it("sums every model and prefers the reported total cost", () => {
    const t = usageTotals(
      {
        a: {
          inputTokens: 1,
          outputTokens: 2,
          cacheReadInputTokens: 3,
          cacheCreationInputTokens: 4,
          costUSD: 0.1,
        },
        b: {
          inputTokens: 10,
          outputTokens: 20,
          cacheReadInputTokens: 30,
          cacheCreationInputTokens: 40,
          costUSD: 0.2,
        },
      },
      0.35
    );
    expect(t).toEqual({
      costUsd: 0.35,
      inputTokens: 11,
      outputTokens: 22,
      cacheReadTokens: 33,
      cacheWriteTokens: 44,
    });
  });
});

describe("turnDelta", () => {
  it("is everything on the first turn", () => {
    expect(turnDelta(null, totals(1, 10))).toEqual(totals(1, 10));
  });

  it("is the growth since the last totals", () => {
    const d = turnDelta(totals(1, 10), totals(1.5, 25));
    expect(d.costUsd).toBeCloseTo(0.5);
    expect(d.inputTokens).toBe(15);
  });

  it("starts again when the totals drop (a /clear or a fresh agent)", () => {
    expect(turnDelta(totals(5, 500), totals(0.2, 30))).toEqual(totals(0.2, 30));
  });
});
