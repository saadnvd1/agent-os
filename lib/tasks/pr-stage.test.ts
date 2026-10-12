import { describe, expect, it } from "vitest";
import {
  derivePrStage,
  PR_STAGE_BUSY,
  PR_STAGE_SHORT,
  PR_STAGES,
  prStageText,
  type PrStageInput,
} from "./pr-stage";

const pr = (over: Partial<NonNullable<PrStageInput["pr"]>> = {}) => ({
  number: 230,
  url: "https://example.test/pull/230",
  state: "OPEN" as const,
  checks: "pass" as const,
  head: "0123456789abcdef",
  mergeable: "MERGEABLE" as const,
  ...over,
});
const stage = (i: Partial<PrStageInput> & { pr?: PrStageInput["pr"] }) =>
  derivePrStage({ pr: pr(), ...i })?.stage;

describe("derivePrStage", () => {
  it("is null with no PR or a closed one", () => {
    expect(derivePrStage({ pr: null })).toBeNull();
    expect(derivePrStage({ pr: pr({ state: "CLOSED" }) })).toBeNull();
  });

  it("carries the number, url and short head", () => {
    expect(derivePrStage({ pr: pr() })).toEqual({
      stage: "open",
      number: 230,
      url: "https://example.test/pull/230",
      sha: "0123456",
    });
  });

  it.each([
    ["merged", { pr: pr({ state: "MERGED" }) }],
    ["conflicts", { pr: pr({ mergeable: "CONFLICTING" }) }],
    ["ci-failed", { pr: pr({ checks: "fail" }) }],
    ["ci-running", { pr: pr({ checks: "pending" }) }],
    ["ci-settling", { settleIn: 30 }],
    ["review-running", { review: "running" as const }],
    ["review-blocked", { review: "block" as const }],
    ["waiting", { held: true }],
    ["armed", { armed: true }],
    ["open", {}],
  ])("%s", (name, input) => {
    expect(stage(input)).toBe(name);
  });

  it("treats no checks, a passed review and an error as past those stages", () => {
    expect(stage({ pr: pr({ checks: "none" }) })).toBe("open");
    expect(stage({ review: "pass" })).toBe("open");
    expect(stage({ review: "error" })).toBe("open");
    expect(stage({ settleIn: 0 })).toBe("open");
  });

  it("settling only applies to green CI", () => {
    expect(stage({ pr: pr({ checks: "pending" }), settleIn: 30 })).toBe(
      "ci-running"
    );
  });

  describe("priority", () => {
    it("merged beats everything", () => {
      expect(
        stage({
          pr: pr({ state: "MERGED", mergeable: "CONFLICTING", checks: "fail" }),
          held: true,
          armed: true,
        })
      ).toBe("merged");
    });
    it("conflicts beat CI running and failed", () => {
      expect(
        stage({ pr: pr({ mergeable: "CONFLICTING", checks: "pending" }) })
      ).toBe("conflicts");
      expect(
        stage({ pr: pr({ mergeable: "CONFLICTING", checks: "fail" }) })
      ).toBe("conflicts");
    });
    it("CI failed beats a running review", () => {
      expect(stage({ pr: pr({ checks: "fail" }), review: "running" })).toBe(
        "ci-failed"
      );
    });
    it("CI settling beats review running", () => {
      expect(stage({ settleIn: 5, review: "running" })).toBe("ci-settling");
    });
    it("review blocked beats waiting on Saad", () => {
      expect(stage({ review: "block", held: true })).toBe("review-blocked");
    });
    it("waiting on Saad beats armed", () => {
      expect(stage({ held: true, armed: true })).toBe("waiting");
    });
  });

  it("spins only for in-progress stages", () => {
    expect([...PR_STAGE_BUSY].sort()).toEqual([
      "ci-running",
      "ci-settling",
      "conflicts",
      "review-running",
    ]);
  });

  it("reads as PR #N · label", () => {
    expect(prStageText({ stage: "review-running", number: 230 })).toBe(
      "PR #230 · reviewing"
    );
  });
});

describe("PR_STAGE_SHORT", () => {
  it("has a short label for every stage", () => {
    for (const s of PR_STAGES)
      expect(PR_STAGE_SHORT[s].length).toBeLessThan(15);
    expect(PR_STAGE_SHORT["ci-running"]).toBe("CI");
    expect(PR_STAGE_SHORT.open).toBe("PR");
  });
});
