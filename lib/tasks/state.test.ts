import { describe, it, expect } from "vitest";
import {
  canSignOff,
  checksVerdict,
  failingCheck,
  deriveTaskState,
  isBlocked,
  rerunsToLookUp,
  settleReruns,
  trustPromptKeys,
  type ActionsRun,
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

describe("reruns of the same check", () => {
  const HEAD = "ab4fdba";
  const review = (runId: number, conclusion: string, status = "COMPLETED") => ({
    __typename: "CheckRun",
    workflowName: "Code review",
    name: "Code review section",
    detailsUrl: `https://github.com/o/r/actions/runs/${runId}/job/9${runId}`,
    conclusion,
    status,
  });
  const run = (
    event: string,
    startedAt: string,
    headSha = HEAD,
    workflowId = 1
  ): ActionsRun => ({ event, headSha, startedAt, workflowId });
  const runs = (byId: Record<number, ActionsRun | null>) =>
    new Map(Object.entries(byId).map(([id, r]) => [`o/r#${id}`, r]));
  const judge = (
    rollup: ReturnType<typeof review>[],
    byId: Record<number, ActionsRun | null>,
    head: string | null = HEAD
  ) => {
    const settled = settleReruns(rollup, head, runs(byId));
    return { checks: checksVerdict(settled), failing: failingCheck(settled) };
  };

  it("looks up runs only for checks that ran more than once", () => {
    const ci = {
      __typename: "CheckRun",
      workflowName: "CI",
      name: "Check",
      detailsUrl: "https://github.com/o/r/actions/runs/7/job/70",
    };
    expect(rerunsToLookUp([ci, review(1, "FAILURE")])).toEqual([]);
    expect(
      rerunsToLookUp([ci, review(1, "FAILURE"), review(2, "SUCCESS")])
    ).toEqual([
      { repo: "o/r", id: "1", attempt: null },
      { repo: "o/r", id: "2", attempt: null },
    ]);
    // An attempt is named by its jobs' latest start, across every check of
    // the run, and isn't named while one of them hasn't started.
    const started = (c: object, startedAt: string) => ({ ...c, startedAt });
    const sameRunJob = {
      ...ci,
      detailsUrl: "https://github.com/o/r/actions/runs/1/job/11",
    };
    expect(
      rerunsToLookUp([
        started(review(1, "FAILURE"), "2026-10-07T02:47:40Z"),
        started(sameRunJob, "2026-10-07T02:51:30Z"),
        started(review(2, "SUCCESS"), "2026-10-07T02:48:35Z"),
      ])
    ).toEqual([
      {
        repo: "o/r",
        id: "1",
        attempt: String(Date.parse("2026-10-07T02:51:30Z")),
      },
      {
        repo: "o/r",
        id: "2",
        attempt: String(Date.parse("2026-10-07T02:48:35Z")),
      },
    ]);
    expect(
      rerunsToLookUp([
        started(review(1, "FAILURE"), "2026-10-07T02:47:40Z"),
        started(sameRunJob, "0001-01-01T00:00:00Z"),
        started(review(2, "SUCCESS"), "2026-10-07T02:48:35Z"),
      ])[0].attempt
    ).toBeNull();
  });

  it("passes on PR #102: a body edit's green run, then the rerun's green", () => {
    // Run 1 failed at 02:47, an edited body started run 2 at 02:48, and run 1
    // was then rerun (attempt 2) at 02:51.
    const rollup = [review(1, "SUCCESS"), review(2, "SUCCESS")];
    const byId = {
      1: run("pull_request_target", "2026-10-07T02:51:28Z"),
      2: run("pull_request_target", "2026-10-07T02:48:31Z"),
    };
    expect(judge(rollup, byId).checks).toBe("pass");
  });

  it("passes once a body edit's run goes green after a failure", () => {
    const byId = {
      1: run("pull_request_target", "2026-10-07T02:47:33Z"),
      2: run("pull_request_target", "2026-10-07T02:48:31Z"),
    };
    for (const rollup of [
      [review(1, "FAILURE"), review(2, "SUCCESS")],
      [review(2, "SUCCESS"), review(1, "FAILURE")],
    ])
      expect(judge(rollup, byId)).toEqual({ checks: "pass", failing: null });
  });

  it("judges by the newer run when the two runs overlapped", () => {
    // The older run was still going (or finished last) when the edit's run
    // started: start order decides, not finish order.
    const byId = {
      1: run("pull_request", "2026-10-07T02:47:33Z"),
      2: run("pull_request", "2026-10-07T02:47:40Z"),
    };
    expect(
      judge([review(1, "FAILURE"), review(2, "SUCCESS")], byId).checks
    ).toBe("pass");
    expect(
      judge([review(1, "FAILURE"), review(2, "", "IN_PROGRESS")], byId).checks
    ).toBe("pending");
  });

  it("fails on a real later failure", () => {
    const byId = {
      1: run("pull_request_target", "2026-10-07T02:47:33Z"),
      2: run("pull_request_target", "2026-10-07T02:51:28Z"),
    };
    expect(judge([review(1, "SUCCESS"), review(2, "FAILURE")], byId)).toEqual({
      checks: "fail",
      failing: "Code review section",
    });
  });

  it("doesn't let a later push run hide a failed pull_request run", () => {
    // One runner: the pull_request run failed and finished before the push
    // run of the same job started and passed.
    const byId = {
      1: run("pull_request", "2026-10-07T02:47:33Z"),
      2: run("push", "2026-10-07T02:50:00Z"),
    };
    expect(
      judge([review(1, "FAILURE"), review(2, "SUCCESS")], byId).checks
    ).toBe("fail");
  });

  it("lets a later pull_request run replace an earlier push run", () => {
    const byId = {
      1: run("push", "2026-10-07T02:47:33Z"),
      2: run("pull_request", "2026-10-07T02:50:00Z"),
    };
    expect(
      judge([review(1, "FAILURE"), review(2, "SUCCESS")], byId).checks
    ).toBe("pass");
  });

  it("never lets a run for another commit count toward a pass", () => {
    const byId = {
      1: run("pull_request", "2026-10-07T02:50:00Z", "0ldc0mm1t"),
      2: run("pull_request", "2026-10-07T02:47:33Z"),
    };
    // Its pass doesn't hide the head's failure, though it started later.
    expect(
      judge([review(1, "SUCCESS"), review(2, "FAILURE")], byId).checks
    ).toBe("fail");
    expect(
      judge([review(1, "SUCCESS"), review(2, "SUCCESS")], byId).checks
    ).toBe("pass");
    // Its failure, shown on the head, can't be judged stale: wait.
    expect(judge([review(1, "FAILURE"), review(2, "SUCCESS")], byId)).toEqual({
      checks: "pending",
      failing: null,
    });
  });

  it("doesn't compare runs of two workflows that share a name", () => {
    const byId = {
      1: run("push", "2026-10-07T02:47:33Z", HEAD, 1),
      2: run("pull_request", "2026-10-07T02:50:00Z", HEAD, 2),
    };
    expect(
      judge([review(1, "FAILURE"), review(2, "SUCCESS")], byId).checks
    ).toBe("pending");
  });

  it("can't order two entries of one run, so waits", () => {
    const byId = { 1: run("pull_request", "2026-10-07T02:51:28Z") };
    expect(judge([review(1, "FAILURE"), review(1, "SUCCESS")], byId)).toEqual({
      checks: "pending",
      failing: null,
    });
  });

  it("fails closed when the API couldn't describe a run", () => {
    const rollup = [review(1, "FAILURE"), review(2, "SUCCESS")];
    for (const byId of <Array<Record<number, ActionsRun | null>>>[
      { 1: run("pull_request", "2026-10-07T02:47:33Z"), 2: null },
      // Never looked up at all.
      { 1: run("pull_request", "2026-10-07T02:47:33Z") },
    ])
      expect(judge(rollup, byId)).toEqual({
        checks: "pending",
        failing: null,
      });
  });

  it("fails closed on ambiguous answers", () => {
    const rollup = [review(1, "FAILURE"), review(2, "SUCCESS")];
    const same = "2026-10-07T02:47:33Z";
    const cases: Array<[Record<number, ActionsRun>, string | null]> = [
      // Both started in the same second.
      [{ 1: run("pull_request", same), 2: run("pull_request", same) }, HEAD],
      // No start time.
      [{ 1: run("pull_request", same), 2: run("pull_request", "") }, HEAD],
      // Neither run is for the head.
      [
        {
          1: run("pull_request", same, "x"),
          2: run("pull_request", same, "y"),
        },
        HEAD,
      ],
      // The PR's head isn't known.
      [
        {
          1: run("pull_request", same),
          2: run("pull_request", "2026-10-07T02:50:00Z"),
        },
        null,
      ],
    ];
    for (const [byId, head] of cases)
      expect(judge(rollup, byId, head).checks).toBe("pending");
  });

  it("counts every run of a check that isn't all GitHub Actions", () => {
    const other = {
      ...review(2, "SUCCESS"),
      detailsUrl: "https://ci.example/2",
    };
    const settled = settleReruns([review(1, "FAILURE"), other], HEAD, runs({}));
    expect(checksVerdict(settled)).toBe("fail");
  });

  it("doesn't let one check's rerun hide another check's failure", () => {
    const ci = {
      __typename: "CheckRun",
      workflowName: "CI",
      name: "Check",
      detailsUrl: "https://github.com/o/r/actions/runs/7/job/70",
      conclusion: "FAILURE",
    };
    const byId = {
      1: run("pull_request_target", "2026-10-07T02:47:33Z"),
      2: run("pull_request_target", "2026-10-07T02:48:31Z"),
    };
    const settled = settleReruns(
      [ci, review(1, "FAILURE"), review(2, "SUCCESS")],
      HEAD,
      runs(byId)
    );
    expect(checksVerdict(settled)).toBe("fail");
    expect(failingCheck(settled)).toBe("Check");
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
