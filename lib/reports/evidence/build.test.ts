import { describe, expect, it } from "vitest";
import {
  ciEvidence,
  diffEvidence,
  evidenceHash,
  reviewEvidence,
  testEvidence,
} from "./build";
import { ev } from "../fixtures";

const AT = "2026-10-21T12:00:00.000Z";

describe("evidence", () => {
  it("turns checks into ci evidence with their state and link", () => {
    const out = ciEvidence(
      [
        {
          name: "unit",
          workflow: null,
          state: "pass",
          conclusion: "success",
          url: "https://ci/1",
          startedAt: null,
          completedAt: null,
          durationSec: 3,
        },
        {
          name: "lint",
          workflow: null,
          state: "fail",
          conclusion: "failure",
          url: null,
          startedAt: null,
          completedAt: null,
          durationSec: null,
          log: { step: "run", tail: "boom", truncated: false },
        },
        {
          name: "skip",
          workflow: null,
          state: "skipped",
          conclusion: null,
          url: null,
          startedAt: null,
          completedAt: null,
          durationSec: null,
        },
      ],
      "abc",
      AT
    );
    expect(out.map((e) => [e.id, e.status])).toEqual([
      ["ci:unit", "pass"],
      ["ci:lint", "fail"],
    ]);
    expect(out[0].url).toBe("https://ci/1");
    expect(out[1].excerpt).toContain("boom");
  });

  it("reads a review verdict, with findings in the excerpt", () => {
    const [r] = reviewEvidence({
      sha: "abcdef123",
      status: "block",
      summary: "Problems",
      findings: [{ severity: "high", file: "a.ts", line: 4, summary: "bad" }],
      at: AT,
      truncated: false,
    });
    expect(r).toMatchObject({ id: "review:abcdef1", status: "fail" });
    expect(r.excerpt).toContain("[high] a.ts:4 bad");
  });

  it("keeps the last result of each check command", () => {
    const out = testEvidence(
      {
        turns: 1,
        toolCalls: 2,
        failedTools: 0,
        filesChanged: [],
        durationMs: 0,
        costUsd: 0,
        interrupted: false,
        errors: 0,
        noToolTurns: 0,
        readWeb: false,
        checks: [
          { command: "npx vitest run a", passed: false },
          { command: "npx vitest run a", passed: true },
        ],
      },
      "s1",
      "abc",
      AT
    );
    expect(out).toHaveLength(1);
    expect(out[0].status).toBe("pass");
  });

  it("lists changed files from numstat", () => {
    const out = diffEvidence(
      "3\t1\tlib/a.ts\n-\t-\timg.png\nnot a line",
      "s1",
      AT
    );
    expect(out.map((e) => e.id)).toEqual(["diff:lib/a.ts", "diff:img.png"]);
  });

  it("hashes ids and statuses, not times or order", () => {
    const a = [ev("x", "ci", "pass"), ev("y", "ci", "fail")];
    const b = [
      { ...ev("y", "ci", "fail"), at: "later" },
      ev("x", "ci", "pass"),
    ];
    expect(evidenceHash(a, "h")).toBe(evidenceHash(b, "h"));
    expect(evidenceHash(a, "h")).not.toBe(
      evidenceHash([ev("x", "ci", "fail")], "h")
    );
  });
});
