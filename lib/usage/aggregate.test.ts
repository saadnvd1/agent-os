import { describe, expect, it } from "vitest";
import { aggregateUsage, dayKey, rangeStart, type TurnRow } from "./aggregate";

const NOW = new Date(2026, 9, 7, 15, 0).getTime();
const DAY = 24 * 60 * 60 * 1000;

function row(over: Partial<TurnRow>): TurnRow {
  return {
    session_id: "s1",
    session_name: "one",
    workspace_id: "w1",
    at: NOW - 1000,
    cost_usd: 0.1,
    input_tokens: 10,
    output_tokens: 5,
    cache_read_tokens: 0,
    cache_write_tokens: 0,
    ...over,
  };
}

const rows = [
  row({ cost_usd: 0.1 }),
  row({ cost_usd: 0.2, at: NOW - 2 * DAY }),
  row({
    session_id: "s2",
    session_name: "two",
    cost_usd: 0.35,
    at: NOW - 3 * DAY,
  }),
  row({
    session_id: "s3",
    session_name: "three",
    workspace_id: null,
    cost_usd: 0.000_001_4,
  }),
  row({
    session_id: "s4",
    session_name: "old",
    cost_usd: 9,
    at: NOW - 40 * DAY,
  }),
];

describe("aggregateUsage", () => {
  it("keeps only the range: today, the last 7 days, the last 30", () => {
    expect(aggregateUsage(rows, "today", {}, NOW).total.turns).toBe(2);
    expect(aggregateUsage(rows, "7d", {}, NOW).total.turns).toBe(4);
    expect(aggregateUsage(rows, "30d", {}, NOW).total.turns).toBe(4);
  });

  it("adds up to the same total by day, by session and by workspace", () => {
    for (const range of ["today", "7d", "30d"] as const) {
      const r = aggregateUsage(rows, range, { w1: "Main" }, NOW);
      for (const parts of [r.days, r.sessions, r.workspaces]) {
        const micros = parts.reduce(
          (sum, p) => sum + Math.round(p.costUsd * 1e6),
          0
        );
        expect(micros).toBe(Math.round(r.total.costUsd * 1e6));
        expect(parts.reduce((sum, p) => sum + p.tokens, 0)).toBe(
          r.total.tokens
        );
        expect(parts.reduce((sum, p) => sum + p.turns, 0)).toBe(r.total.turns);
      }
    }
  });

  it("has one row per day of the range, empty days included", () => {
    const r = aggregateUsage(rows, "7d", {}, NOW);
    expect(r.days).toHaveLength(7);
    expect(r.days.at(-1)?.date).toBe(dayKey(NOW));
    expect(r.days[0].date).toBe(dayKey(rangeStart("7d", NOW)));
    expect(r.days.filter((d) => d.turns === 0)).toHaveLength(4);
  });

  it("names workspaces and ranks by cost", () => {
    const r = aggregateUsage(rows, "7d", { w1: "Main" }, NOW);
    expect(r.workspaces.map((w) => w.name)).toEqual(["Main", "No workspace"]);
    expect(r.sessions.map((s) => s.name)).toEqual(["two", "one", "three"]);
    expect(r.sessions[1].costUsd).toBeCloseTo(0.3);
  });
});
