import { describe, expect, it } from "vitest";
import { latestChecks, signalLine, turnSignals } from "./signals";
import { bash, edit, end, said, tool, user } from "./__fixtures__/items";

describe("turnSignals", () => {
  it("counts a turn with no tool calls", () => {
    const s = turnSignals([user("fix it"), said("I would fix it by…"), end()]);
    expect(s).toMatchObject({ turns: 1, toolCalls: 0, noToolTurns: 1 });
    expect(signalLine(s)).toContain("1 turn with no tool calls");
  });

  it("reads a failing check from the tool's status, and the last run wins", () => {
    const s = turnSignals([
      user("go"),
      bash("npx vitest run lib/x.test.ts", {
        status: "error",
        output: "1 failed",
      }),
      edit("lib/x.ts", "a", "b"),
      bash("npx vitest run lib/x.test.ts"),
      bash("ls"),
      end({ costUsd: 0.25, durationMs: 3_000 }),
    ]);
    expect(s.toolCalls).toBe(4);
    expect(s.failedTools).toBe(1);
    expect(s.checks).toHaveLength(2);
    expect(latestChecks(s)).toEqual([
      { command: "npx vitest run lib/x.test.ts", passed: true },
    ]);
    expect(s.filesChanged).toEqual(["lib/x.ts"]);
    expect(s.costUsd).toBeCloseTo(0.25);
    expect(s.noToolTurns).toBe(0);
  });

  it("notes an interrupted turn, error items and web content", () => {
    const s = turnSignals([
      user("look it up"),
      tool("WebFetch", { url: "https://example.com" }),
      { id: "e", createdAt: 1, kind: "error", message: "boom" },
      end({ interrupted: true }),
      user("again"),
      bash("curl -s https://example.com/x"),
      end(),
    ]);
    expect(s).toMatchObject({
      turns: 2,
      interrupted: true,
      errors: 1,
      readWeb: true,
      noToolTurns: 0,
    });
    expect(s.costUsd).toBeCloseTo(0.2);
  });

  it("doesn't count a local curl as web content", () => {
    expect(
      turnSignals([user("x"), bash("curl -s http://localhost:3000/api"), end()])
        .readWeb
    ).toBe(false);
  });
});
