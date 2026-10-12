import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db, type Session } from "../db";
import { TRUST_HEADER } from "../security/auth";
import { putCheck } from "../orchestrator/checks";
import { seedSession, seedWorkspace } from "../orchestrator/testing";
import { CHECK_LOG_MAX_BYTES } from "./loop-types";

vi.mock("./gh", async (orig) => ({
  ...(await orig<typeof import("./gh")>()),
  run: vi.fn(),
  settledRollup: vi.fn(async (_d, _u, _h, rollup) => rollup),
}));
vi.mock("./session", async (orig) => ({
  ...(await orig<typeof import("./session")>()),
  prFor: vi.fn(),
}));

const gh = await import("./gh");
const sessionMod = await import("./session");
const { taskChecks, toTaskChecks, checkState, resetLogCache } =
  await import("./checks-view");
const route = await import("@/app/api/tasks/[id]/checks/route");

const HEAD = "a".repeat(40);
const JOB = "https://github.com/o/r/actions/runs/1/job/22";
const rollup = [
  {
    name: "build",
    workflowName: "CI",
    conclusion: "SUCCESS",
    detailsUrl: "https://github.com/o/r/actions/runs/1/job/21",
    startedAt: "2026-10-12T10:00:00Z",
    completedAt: "2026-10-12T10:01:30Z",
  },
  {
    name: "test",
    workflowName: "CI",
    conclusion: "FAILURE",
    detailsUrl: JOB,
    startedAt: "2026-10-12T10:00:00Z",
    completedAt: "0001-01-01T00:00:00Z",
  },
  { context: "deploy", state: "PENDING", detailsUrl: "javascript:alert(1)" },
];

let ws: ReturnType<typeof seedWorkspace>;
let session: Session;
const failedLog = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  resetLogCache();
  ws = seedWorkspace();
  const id = seedSession({ projectId: ws.app.id, name: "checks", task: true });
  db.prepare(`UPDATE sessions SET pr_number = 5 WHERE id = ?`).run(id);
  session = db
    .prepare(`SELECT * FROM sessions WHERE id = ?`)
    .get(id) as Session;
  vi.mocked(sessionMod.prFor).mockResolvedValue({
    number: 5,
    url: "https://github.com/o/r/pull/5",
    state: "OPEN",
    checks: "fail",
    head: HEAD,
  });
  vi.mocked(gh.run).mockResolvedValue(
    JSON.stringify({ headRefOid: HEAD, statusCheckRollup: rollup })
  );
  failedLog.mockResolvedValue({ step: "Run tests", tail: "FAIL a.test.ts" });
});

describe("task checks", () => {
  it("lists the checks with state, link and duration", async () => {
    const out = await taskChecks(session, { deps: { failedLog } });
    expect(out.pr).toMatchObject({ number: 5, head: HEAD });
    expect(out.checks.map((c) => [c.name, c.state])).toEqual([
      ["build", "pass"],
      ["test", "fail"],
      ["deploy", "pending"],
    ]);
    expect(out.checks[0]).toMatchObject({ workflow: "CI", durationSec: 90 });
    // gh's zero completedAt is no time at all.
    expect(out.checks[1]).toMatchObject({
      completedAt: null,
      durationSec: null,
    });
    // Only a web link is kept.
    expect(out.checks[2].url).toBeNull();
  });

  it("attaches the failing log to a failing check only, capped", async () => {
    failedLog.mockResolvedValue({
      step: "s",
      tail: "x".repeat(CHECK_LOG_MAX_BYTES + 50),
    });
    const out = await taskChecks(session, { deps: { failedLog } });
    expect(failedLog).toHaveBeenCalledTimes(1);
    expect(failedLog.mock.calls[0][2]).toBe(JOB);
    expect(out.checks[0].log).toBeUndefined();
    expect(out.checks[1].log).toMatchObject({ step: "s", truncated: true });
    expect(out.checks[1].log!.tail).toHaveLength(CHECK_LOG_MAX_BYTES);
  });

  it("skips logs on request and survives a log failure", async () => {
    const skipped = await taskChecks(session, {
      logs: false,
      deps: { failedLog },
    });
    expect(failedLog).not.toHaveBeenCalled();
    expect(skipped.checks[1].log).toBeUndefined();
    failedLog.mockRejectedValue(new Error("boom"));
    const errored = await taskChecks(session, { deps: { failedLog } });
    expect(errored.checks).toHaveLength(3);
    expect(errored.checks[1].log).toBeUndefined();
  });

  it("returns the review gate's verdict for the head", async () => {
    expect((await taskChecks(session, { logs: false })).review).toBeNull();
    putCheck({
      workspaceId: ws.workspace.id,
      sessionId: session.id,
      sha: HEAD,
      kind: "review",
      status: "block",
      detail: "Needs work.\n- [blocking] lib/a.ts:3: leaks a token",
    });
    // A review of another commit doesn't cover the head.
    putCheck({
      workspaceId: ws.workspace.id,
      sessionId: session.id,
      sha: "b".repeat(40),
      kind: "review",
      status: "pass",
      detail: "fine",
    });
    const out = await taskChecks(session, { logs: false });
    expect(out.review).toMatchObject({
      sha: HEAD,
      status: "block",
      summary: "Needs work.",
      findings: [
        {
          severity: "blocking",
          file: "lib/a.ts",
          line: 3,
          summary: "leaks a token",
        },
      ],
      truncated: false,
    });
  });

  it("has nothing for a task without a PR", async () => {
    vi.mocked(sessionMod.prFor).mockResolvedValue(null);
    expect(await taskChecks(session)).toEqual({
      pr: null,
      checks: [],
      review: null,
    });
  });

  it("buckets outcomes", () => {
    expect(checkState({ conclusion: "TIMED_OUT" })).toBe("fail");
    expect(checkState({ conclusion: "SKIPPED" })).toBe("skipped");
    expect(checkState({ conclusion: "CANCELLED" })).toBe("cancelled");
    expect(checkState({ conclusion: "NEUTRAL" })).toBe("neutral");
    expect(checkState({ status: "IN_PROGRESS" })).toBe("pending");
    expect(toTaskChecks([])).toEqual([]);
  });

  it("answers over the route, 404 for an unknown task", async () => {
    const call = (id: string) =>
      route.GET(
        new NextRequest(`http://localhost/api/tasks/${id}/checks?log=0`, {
          headers: { [TRUST_HEADER]: "device" },
        }),
        { params: Promise.resolve({ id }) }
      );
    const ok = await call(session.id);
    expect(ok.status).toBe(200);
    expect((await ok.json()).checks).toHaveLength(3);
    expect((await call("nope")).status).toBe(404);
  });
});
