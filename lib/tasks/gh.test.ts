import { describe, it, expect, vi, beforeEach } from "vitest";

const JQ =
  "{event, headSha: .head_sha, startedAt: .run_started_at, workflowId: .workflow_id}";

const calls: string[][] = [];
// Raw Actions API runs, as GitHub returns them, by API path.
let api: Record<string, Record<string, unknown>> = {};
let rollup: unknown[] = [];
let prState = "OPEN";

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
        state: prState,
        headRefOid: "HEAD",
        statusCheckRollup: rollup,
      };
      return cb(null, { stdout: JSON.stringify([pr]) });
    }
    const raw = api[args[1]];
    if (raw === undefined) return cb(new Error("HTTP 502"));
    // Apply the one jq filter gh.ts asks for, so a wrong field fails here.
    if (args[3] !== JQ) return cb(new Error(`unexpected jq: ${args[3]}`));
    const out = {
      event: raw.event,
      headSha: raw.head_sha,
      startedAt: raw.run_started_at,
      workflowId: raw.workflow_id,
    };
    cb(null, { stdout: JSON.stringify(out) });
  },
}));

let findPRStrict: typeof import("./gh").findPRStrict;

const check = (
  runId: number,
  conclusion: string,
  { repo = "o/r", name = "Check", startedAt = "" } = {}
) => ({
  __typename: "CheckRun",
  workflowName: "CI",
  name,
  detailsUrl: `https://github.com/${repo}/actions/runs/${runId}/job/${runId}0`,
  conclusion,
  status: "COMPLETED",
  startedAt,
});
// run_started_at is the latest attempt's start; created_at is the first's.
const run = (
  event: string,
  runStartedAt: string,
  { headSha = "HEAD", createdAt = runStartedAt } = {}
) => ({
  event,
  head_sha: headSha,
  run_started_at: runStartedAt,
  created_at: createdAt,
  workflow_id: 42,
});
const apiCalls = () => calls.filter((a) => a[0] === "api").map((a) => a[1]);

beforeEach(async () => {
  calls.length = 0;
  api = {};
  prState = "OPEN";
  vi.resetModules();
  ({ findPRStrict } = await import("./gh"));
});

describe("findPRStrict's check runs", () => {
  it("makes no API call when no check ran twice", async () => {
    rollup = [check(1, "SUCCESS")];
    expect((await findPRStrict("/repo", "b"))?.checks).toBe("pass");
    expect(apiCalls()).toEqual([]);
  });

  it("makes no API call for a closed PR", async () => {
    prState = "MERGED";
    rollup = [check(1, "FAILURE"), check(2, "SUCCESS")];
    await findPRStrict("/repo", "b");
    expect(apiCalls()).toEqual([]);
  });

  it("passes PR #102: a failed run rerun green after a body edit's run", async () => {
    // Run 1 was created at 02:47 and failed; the edited body started run 2 at
    // 02:48; run 1 was rerun at 02:51. Ordering by created_at would be wrong.
    rollup = [
      check(1, "SUCCESS", { name: "Code review section" }),
      check(2, "FAILURE", { name: "Code review section" }),
    ];
    api = {
      "repos/o/r/actions/runs/1": run(
        "pull_request_target",
        "2026-10-07T02:51:28Z",
        { createdAt: "2026-10-07T02:47:33Z" }
      ),
      "repos/o/r/actions/runs/2": run(
        "pull_request_target",
        "2026-10-07T02:48:31Z"
      ),
    };
    expect((await findPRStrict("/repo", "b"))?.checks).toBe("pass");
  });

  it("looks each run up once and drops the one a rerun replaced", async () => {
    rollup = [
      check(1, "FAILURE"),
      check(2, "SUCCESS"),
      check(2, "SUCCESS", { name: "Lint" }),
      check(1, "SUCCESS", { name: "Lint" }),
    ];
    api = {
      "repos/o/r/actions/runs/1": run("pull_request", "2026-10-07T02:47:33Z"),
      "repos/o/r/actions/runs/2": run("pull_request", "2026-10-07T02:48:31Z"),
    };
    expect((await findPRStrict("/repo", "b"))?.checks).toBe("pass");
    expect(apiCalls().sort()).toEqual([
      "repos/o/r/actions/runs/1",
      "repos/o/r/actions/runs/2",
    ]);
  });

  it("remembers a started attempt across polls, and asks again on a rerun", async () => {
    const first = [
      check(1, "FAILURE", { startedAt: "2026-10-07T02:47:40Z" }),
      check(2, "SUCCESS", { startedAt: "2026-10-07T02:48:35Z" }),
    ];
    api = {
      "repos/o/r/actions/runs/1": run("pull_request", "2026-10-07T02:47:33Z"),
      "repos/o/r/actions/runs/2": run("pull_request", "2026-10-07T02:48:31Z"),
    };
    rollup = first;
    await findPRStrict("/repo", "b");
    calls.length = 0;
    await findPRStrict("/repo", "b");
    expect(apiCalls()).toEqual([]);

    // Run 1 is rerun and fails again: its job's new start misses the cache,
    // so the newer start is seen and the failure stands.
    api["repos/o/r/actions/runs/1"] = run(
      "pull_request",
      "2026-10-07T02:55:00Z"
    );
    rollup = [
      check(1, "FAILURE", { startedAt: "2026-10-07T02:55:05Z" }),
      first[1],
    ];
    expect((await findPRStrict("/repo", "b"))?.checks).toBe("fail");
    expect(apiCalls()).toEqual(["repos/o/r/actions/runs/1"]);
  });

  it("doesn't remember a run whose job hasn't started", async () => {
    rollup = [check(1, "FAILURE"), check(2, "", { startedAt: "" })];
    api = {
      "repos/o/r/actions/runs/1": run("pull_request", "2026-10-07T02:47:33Z"),
      "repos/o/r/actions/runs/2": run("pull_request", "2026-10-07T02:48:31Z"),
    };
    await findPRStrict("/repo", "b");
    calls.length = 0;
    await findPRStrict("/repo", "b");
    expect(apiCalls().length).toBe(2);
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

  it("reads as not settled when the API fails, and retries next time", async () => {
    rollup = [check(1, "FAILURE"), check(2, "SUCCESS")];
    api = {
      "repos/o/r/actions/runs/1": run("pull_request", "2026-10-07T02:47:33Z"),
    };
    expect((await findPRStrict("/repo", "b"))?.checks).toBe("pending");
    api["repos/o/r/actions/runs/2"] = run(
      "pull_request",
      "2026-10-07T02:48:31Z"
    );
    expect((await findPRStrict("/repo", "b"))?.checks).toBe("pass");
  });

  it("reads as not settled when the API's answer is incomplete", async () => {
    rollup = [check(1, "FAILURE"), check(2, "SUCCESS")];
    api = {
      "repos/o/r/actions/runs/1": run("pull_request", "2026-10-07T02:47:33Z"),
      "repos/o/r/actions/runs/2": { event: "pull_request" },
    };
    expect((await findPRStrict("/repo", "b"))?.checks).toBe("pending");
  });

  it("never asks about, or trusts, a run in another repo", async () => {
    rollup = [check(1, "FAILURE"), check(2, "SUCCESS", { repo: "evil/r" })];
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
