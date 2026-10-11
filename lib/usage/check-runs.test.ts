import { randomUUID } from "crypto";
import { describe, expect, it } from "vitest";
import {
  checkRunTotals,
  describeCheckRuns,
  recordCheckRun,
  runUsageOf,
  type RunUsage,
} from "./check-runs";
import { checkRunReport } from "./report";

const usage = (over: Partial<RunUsage> = {}): RunUsage => ({
  model: "claude-opus-5-5",
  inputTokens: 5,
  cacheWriteTokens: 40_000,
  cacheReadTokens: 300_000,
  outputTokens: 2_000,
  costUsd: 0.5,
  durationMs: 90_000,
  ...over,
});

describe("runUsageOf", () => {
  it("sums every model in a claude -p result and names the costliest", () => {
    expect(
      runUsageOf({
        type: "result",
        duration_ms: 61_000,
        total_cost_usd: 0.61,
        usage: { input_tokens: 1, output_tokens: 1 },
        modelUsage: {
          "claude-haiku-4-5": {
            inputTokens: 100,
            outputTokens: 50,
            cacheReadInputTokens: 0,
            cacheCreationInputTokens: 0,
            costUSD: 0.01,
          },
          "claude-opus-5-5": {
            inputTokens: 10,
            outputTokens: 3000,
            cacheReadInputTokens: 200_000,
            cacheCreationInputTokens: 30_000,
            costUSD: 0.6,
          },
        },
      })
    ).toEqual({
      model: "claude-opus-5-5",
      inputTokens: 110,
      cacheWriteTokens: 30_000,
      cacheReadTokens: 200_000,
      outputTokens: 3050,
      costUsd: 0.61,
      durationMs: 61_000,
    });
  });

  it("falls back to the totals, and is null with no usage at all", () => {
    expect(
      runUsageOf({
        usage: {
          input_tokens: 3,
          cache_creation_input_tokens: 7,
          cache_read_input_tokens: 9,
          output_tokens: 11,
        },
        total_cost_usd: 0.02,
      })
    ).toEqual({
      model: null,
      inputTokens: 3,
      cacheWriteTokens: 7,
      cacheReadTokens: 9,
      outputTokens: 11,
      costUsd: 0.02,
      durationMs: null,
    });
    expect(runUsageOf({ result: "x" })).toBeNull();
    expect(runUsageOf(null)).toBeNull();
    expect(runUsageOf("nope")).toBeNull();
  });
});

describe("check runs", () => {
  it("adds up every run of one commit, and only that commit", () => {
    const sessionId = randomUUID();
    const at = { workspaceId: "w", sessionId, label: "task t", prNumber: 3 };
    recordCheckRun({ ...at, sha: "a", kind: "review" }, usage());
    recordCheckRun({ ...at, sha: "a", kind: "scope" }, usage({ costUsd: 0.1 }));
    recordCheckRun({ ...at, sha: "b", kind: "review" }, usage());
    const a = checkRunTotals(sessionId, "a")!;
    expect(a).toMatchObject({ runs: 2, tokens: 684_010, durationMs: 180_000 });
    expect(a.costUsd).toBeCloseTo(0.6);
    expect(describeCheckRuns(a)).toBe(
      "2 runs · 684k tokens · $0.60 · 3m 0s · claude-opus-5-5"
    );
    expect(checkRunTotals(sessionId, "c")).toBeNull();
  });

  it("show in Usage by PR, named once", () => {
    const task = randomUUID();
    const ext = randomUUID();
    const now = Date.now();
    recordCheckRun(
      {
        workspaceId: "w",
        sessionId: task,
        label: "task add-a",
        prNumber: 7,
        sha: "a",
        kind: "review",
      },
      usage({ costUsd: 2 }),
      now
    );
    recordCheckRun(
      {
        workspaceId: "w",
        sessionId: ext,
        label: "PR o/r#5",
        prNumber: 5,
        sha: "b",
        kind: "review",
      },
      usage({ costUsd: 1 }),
      now
    );
    const names = checkRunReport("today", now + 1).sessions.map((s) => s.name);
    expect(names).toContain("task add-a · PR #7");
    expect(names).toContain("PR o/r#5");
  });
});
