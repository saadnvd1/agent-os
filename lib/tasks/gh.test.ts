import { describe, it, expect, vi, beforeEach } from "vitest";

const calls: string[][] = [];
let api: Record<string, unknown> = {};
let rollup: unknown[] = [];

vi.mock("child_process", () => ({
  execFile: (
    _cmd: string,
    args: string[],
    _opts: unknown,
    cb: (err: Error | null, out?: { stdout: string }) => void
  ) => {
    calls.push(args);
    if (args[0] === "pr") {
      const pr = {
        number: 7,
        url: "https://github.com/o/r/pull/7",
        state: "OPEN",
        headRefOid: "HEAD",
        statusCheckRollup: rollup,
      };
      return cb(null, { stdout: JSON.stringify([pr]) });
    }
    const answer = api[args[1]];
    if (answer === undefined) return cb(new Error("HTTP 502"));
    cb(null, { stdout: JSON.stringify(answer) });
  },
}));

const { findPRStrict } = await import("./gh");

const check = (runId: number, conclusion: string, repo = "o/r") => ({
  __typename: "CheckRun",
  workflowName: "CI",
  name: "Check",
  detailsUrl: `https://github.com/${repo}/actions/runs/${runId}/job/${runId}0`,
  conclusion,
  status: "COMPLETED",
});
const run = (event: string, startedAt: string, headSha = "HEAD") => ({
  event,
  headSha,
  startedAt,
});
const apiCalls = () => calls.filter((a) => a[0] === "api").map((a) => a[1]);

beforeEach(() => {
  calls.length = 0;
  api = {};
});

describe("findPRStrict's check runs", () => {
  it("makes no API call when no check ran twice", async () => {
    rollup = [check(1, "SUCCESS")];
    expect((await findPRStrict("/repo", "b"))?.checks).toBe("pass");
    expect(apiCalls()).toEqual([]);
  });

  it("looks each run up once and drops the one a rerun replaced", async () => {
    rollup = [
      check(1, "FAILURE"),
      check(2, "SUCCESS"),
      { ...check(2, "SUCCESS"), name: "Lint" },
      { ...check(1, "SUCCESS"), name: "Lint" },
    ];
    api = {
      "repos/o/r/actions/runs/1": run("pull_request", "2026-10-07T02:47:33Z"),
      "repos/o/r/actions/runs/2": run("pull_request", "2026-10-07T02:48:31Z"),
    };
    const pr = await findPRStrict("/repo", "b");
    expect(pr?.checks).toBe("pass");
    expect(apiCalls().sort()).toEqual([
      "repos/o/r/actions/runs/1",
      "repos/o/r/actions/runs/2",
    ]);
  });

  it("keeps a failed pull_request run that a later push run followed", async () => {
    rollup = [check(1, "FAILURE"), check(2, "SUCCESS")];
    api = {
      "repos/o/r/actions/runs/1": run("pull_request", "2026-10-07T02:47:33Z"),
      "repos/o/r/actions/runs/2": run("push", "2026-10-07T02:50:00Z"),
    };
    const pr = await findPRStrict("/repo", "b");
    expect(pr?.checks).toBe("fail");
    expect(pr?.failing).toBe("Check");
  });

  it("reads as not settled when the API fails", async () => {
    rollup = [check(1, "FAILURE"), check(2, "SUCCESS")];
    api = {
      "repos/o/r/actions/runs/1": run("pull_request", "2026-10-07T02:47:33Z"),
    };
    expect((await findPRStrict("/repo", "b"))?.checks).toBe("pending");
  });

  it("reads as not settled when the API's answer is malformed", async () => {
    rollup = [check(1, "FAILURE"), check(2, "SUCCESS")];
    api = {
      "repos/o/r/actions/runs/1": run("pull_request", "2026-10-07T02:47:33Z"),
      "repos/o/r/actions/runs/2": { event: "pull_request" },
    };
    expect((await findPRStrict("/repo", "b"))?.checks).toBe("pending");
  });

  it("never asks about, or trusts, a run in another repo", async () => {
    rollup = [check(1, "FAILURE"), check(2, "SUCCESS", "evil/r")];
    api = {
      "repos/o/r/actions/runs/1": run("pull_request", "2026-10-07T02:47:33Z"),
      "repos/evil/r/actions/runs/2": run(
        "pull_request",
        "2026-10-07T02:50:00Z"
      ),
    };
    expect((await findPRStrict("/repo", "b"))?.checks).toBe("pending");
    expect(apiCalls()).toEqual(["repos/o/r/actions/runs/1"]);
  });
});
