// The CI-green event waits for the settle window sign_off's ci gate uses.

import { describe, expect, it, vi } from "vitest";
import type { Session } from "@/lib/db";
import type { TaskPR } from "@/lib/tasks/state";
import { seedSession, seedWorkspace } from "./testing";

let commitAt = 0;
vi.mock("./repo", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./repo")>()),
  commitTime: async () => {
    if (commitAt < 0) throw new Error("no such commit");
    return commitAt;
  },
}));

const { db } = await import("@/lib/db");
const { putCheck } = await import("./checks");
const { settleIn } = await import("./facts");
const { nextDiffAt, DIFF_BUSY_MS, DIFF_IDLE_MS } = await import("./watcher");
const { SETTLE_S } = await import("./task-state");

function setup() {
  const { workspace, api } = seedWorkspace();
  const id = seedSession({ projectId: api.id, name: "t", task: true });
  const row = db.prepare(`SELECT * FROM sessions WHERE id = ?`).get(id);
  return { w: workspace.id, s: row as Session };
}
const green = (head: string, over: Partial<TaskPR> = {}): TaskPR => ({
  number: 1,
  url: "u",
  state: "OPEN",
  checks: "pass",
  head,
  checkCount: 2,
  ...over,
});
const now = () => Math.floor(Date.now() / 1000);

describe("settleIn", () => {
  it("counts down from a fresh commit, and is 0 once it and its checks have sat still", async () => {
    const t = setup();
    commitAt = now() - 30;
    const fresh = await settleIn(t.w, t.s, green("a".repeat(40)));
    expect(fresh).toBeGreaterThan(SETTLE_S - 5);
    commitAt = now() - 3600;
    putCheck({
      workspaceId: t.w,
      sessionId: t.s.id,
      sha: "b".repeat(40),
      kind: "ci",
      status: "pass",
      detail: JSON.stringify({ count: 2, at: now() - 3600 }),
    });
    expect(await settleIn(t.w, t.s, green("b".repeat(40)))).toBe(0);
  });

  // Checks that sat still since before the commit don't settle it.
  const oldCheck = (t: ReturnType<typeof setup>, sha: string) =>
    putCheck({
      workspaceId: t.w,
      sessionId: t.s.id,
      sha,
      kind: "ci",
      status: "pass",
      detail: JSON.stringify({ count: 2, at: now() - 3600 }),
    });

  it("waits out a fresh commit even when its checks have sat still", async () => {
    const t = setup();
    oldCheck(t, "e".repeat(40));
    commitAt = now() - 30;
    const left = await settleIn(t.w, t.s, green("e".repeat(40)));
    expect(left).toBeGreaterThanOrEqual(SETTLE_S - 35);
    expect(left).toBeLessThanOrEqual(SETTLE_S - 25);
  });

  it("goes by the checks alone when the commit's time can't be read", async () => {
    const t = setup();
    commitAt = -1;
    oldCheck(t, "c".repeat(40));
    expect(await settleIn(t.w, t.s, green("c".repeat(40)))).toBe(0);
  });

  it("is undefined for anything but green CI on an open PR", async () => {
    const t = setup();
    commitAt = now();
    for (const over of [
      { checks: "pending" as const },
      { checks: "fail" as const },
      { state: "MERGED" as const },
      { head: undefined },
    ])
      expect(await settleIn(t.w, t.s, green("d".repeat(40), over))).toBe(
        undefined
      );
  });
});

describe("nextDiffAt", () => {
  const task = (ciSettleIn?: number) => ({
    task: { state: "review" as const, pr: null, blocked: null, ciSettleIn },
  });
  it("looks again just after CI settles, never later than the interval", () => {
    expect(nextDiffAt(1000, [task(30)], false)).toBe(1000 + 31_000);
    expect(nextDiffAt(1000, [task(), task(0)], false)).toBe(
      1000 + DIFF_IDLE_MS
    );
    expect(nextDiffAt(1000, [task(90)], true)).toBe(1000 + DIFF_BUSY_MS);
    expect(nextDiffAt(1000, [task(90), task(5)], false)).toBe(1000 + 6000);
  });
});
