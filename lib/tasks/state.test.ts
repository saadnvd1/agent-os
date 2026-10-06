import { describe, it, expect } from "vitest";
import {
  canSignOff,
  checksVerdict,
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
