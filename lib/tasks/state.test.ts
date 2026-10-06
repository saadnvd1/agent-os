import { describe, it, expect } from "vitest";
import {
  canSignOff,
  checksVerdict,
  failingCheck,
  deriveTaskState,
  isBlocked,
  trustPromptKeys,
  type TaskPR,
} from "./state";

const pr = (over: Partial<TaskPR> = {}): TaskPR => ({
  number: 1,
  url: "u",
  state: "OPEN",
  checks: "pass",
  ...over,
});

describe("deriveTaskState", () => {
  const base = { taskStatus: "running" as const, blocked: false, pr: null };

  it("tracks the agent until a PR exists", () => {
    expect(deriveTaskState({ ...base, sessionStatus: "running" })).toBe(
      "working"
    );
    expect(deriveTaskState({ ...base, sessionStatus: "waiting" })).toBe(
      "needs-input"
    );
    expect(deriveTaskState({ ...base, sessionStatus: "dead" })).toBe("exited");
  });

  it("an open PR means review, or checks-failing", () => {
    expect(
      deriveTaskState({ ...base, sessionStatus: "waiting", pr: pr() })
    ).toBe("review");
    expect(
      deriveTaskState({
        ...base,
        sessionStatus: "waiting",
        pr: pr({ checks: "fail" }),
      })
    ).toBe("checks-failing");
  });

  it("blocked outranks an open PR; merged and dropped are final", () => {
    expect(
      deriveTaskState({
        ...base,
        sessionStatus: "waiting",
        pr: pr(),
        blocked: true,
      })
    ).toBe("blocked");
    expect(
      deriveTaskState({
        ...base,
        sessionStatus: "dead",
        pr: pr({ state: "MERGED" }),
      })
    ).toBe("merged");
    expect(
      deriveTaskState({ ...base, taskStatus: "dropped", sessionStatus: "dead" })
    ).toBe("dropped");
    expect(
      deriveTaskState({ ...base, taskStatus: "done", sessionStatus: "dead" })
    ).toBe("done");
  });
});

describe("canSignOff", () => {
  it("needs an open PR with green or no checks", () => {
    expect(canSignOff(null).ok).toBe(false);
    expect(canSignOff(pr({ checks: "fail" })).ok).toBe(false);
    expect(canSignOff(pr({ checks: "pending" })).ok).toBe(false);
    expect(canSignOff(pr({ state: "CLOSED" })).ok).toBe(false);
    expect(canSignOff(pr({ checks: "none" })).ok).toBe(true);
    expect(canSignOff(pr()).ok).toBe(true);
  });
});

describe("checksVerdict", () => {
  it("fails on any failure, pends on anything unfinished", () => {
    expect(checksVerdict([])).toBe("none");
    expect(
      checksVerdict([{ conclusion: "SUCCESS" }, { state: "SUCCESS" }])
    ).toBe("pass");
    expect(
      checksVerdict([{ conclusion: "SUCCESS" }, { conclusion: "FAILURE" }])
    ).toBe("fail");
    expect(checksVerdict([{ status: "IN_PROGRESS", conclusion: "" }])).toBe(
      "pending"
    );
  });
});

describe("cancelled check runs", () => {
  const cancelled = { name: "code-review", conclusion: "CANCELLED" };

  it("ignores a cancelled run when the same check also ran", () => {
    const rollup = [
      cancelled,
      { name: "code-review", conclusion: "SUCCESS" },
      { name: "test", conclusion: "SUCCESS" },
    ];
    expect(checksVerdict(rollup)).toBe("pass");
    expect(failingCheck(rollup)).toBeNull();
  });

  it("still fails when the surviving run failed", () => {
    const rollup = [cancelled, { name: "code-review", conclusion: "FAILURE" }];
    expect(checksVerdict(rollup)).toBe("fail");
    expect(failingCheck(rollup)).toBe("code-review");
  });

  it("pends while the replacement run is still going", () => {
    expect(
      checksVerdict([
        cancelled,
        { name: "code-review", status: "IN_PROGRESS", conclusion: "" },
      ])
    ).toBe("pending");
  });

  it("treats a lone cancelled run as pending, not failing", () => {
    const rollup = [cancelled, { name: "test", conclusion: "SUCCESS" }];
    expect(checksVerdict(rollup)).toBe("pending");
    expect(failingCheck(rollup)).toBeNull();
  });

  it("matches status contexts by context name", () => {
    expect(
      checksVerdict([
        { context: "ci/build", state: "CANCELLED" },
        { context: "ci/build", state: "SUCCESS" },
      ])
    ).toBe("pass");
  });

  it("keeps same-named jobs in different workflows apart", () => {
    const rollup = [
      { name: "test", workflowName: "CI", conclusion: "CANCELLED" },
      { name: "test", workflowName: "Nightly", conclusion: "SUCCESS" },
    ];
    expect(checksVerdict(rollup)).toBe("pending");
    expect(failingCheck(rollup)).toBeNull();
  });

  it("keeps a check run and a status context of the same name apart", () => {
    expect(
      checksVerdict([
        { __typename: "CheckRun", name: "lint", conclusion: "CANCELLED" },
        { __typename: "StatusContext", context: "lint", state: "SUCCESS" },
      ])
    ).toBe("pending");
  });

  it("doesn't let another check's run excuse a cancelled one", () => {
    expect(
      checksVerdict([cancelled, { name: "test", conclusion: "FAILURE" }])
    ).toBe("fail");
    expect(
      failingCheck([cancelled, { name: "test", conclusion: "FAILURE" }])
    ).toBe("test");
  });
});

describe("isBlocked", () => {
  it("spots the agent's BLOCKED line", () => {
    expect(isBlocked("work\n⏺ BLOCKED: need an API key\n> ")).toBe(true);
    expect(isBlocked("I will not get blocked")).toBe(false);
  });
});

describe("trustPromptKeys", () => {
  const prompt = (sel: "no" | "yes") =>
    `Quick safety check\n ${sel === "no" ? "❯" : " "} No, exit\n ${sel === "yes" ? "❯" : " "} Yes, I trust this folder\n Enter to confirm`;

  it("moves off the default No before confirming", () => {
    expect(trustPromptKeys(prompt("no"))).toEqual(["Down", "Enter"]);
    expect(trustPromptKeys(prompt("yes"))).toEqual(["Enter"]);
  });

  it("does nothing when the prompt is not on screen", () => {
    expect(trustPromptKeys("> working on it")).toBeNull();
  });
});
