import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../../db";

const relaySend = vi.fn();
vi.mock("./relay", () => ({
  linked: () => true,
  NOT_LINKED: "this machine isn't linked to Connect",
  relaySend: (...a: unknown[]) => relaySend(...a),
}));
vi.mock("./presence", () => ({ atMac: async () => false }));

const { seedWorkspace } = await import("../../orchestrator/testing");
const { raiseAsk } = await import("../../orchestrator/asks");
const { ensureOrchestrator } = await import("../../orchestrator/home");
const { noteWaiting } = await import("./waiting");
const events = await import("./events");
const { pushPrChange } = await import("../../tasks/session");
const { sender } = await import("./index");
const { outboxRows, pairPhone, resetPush } = await import("./testing");

// Events fire without being awaited: wait for the outbox to catch up.
const rows = async (n: number) => {
  await vi.waitFor(() => expect(outboxRows().length).toBeGreaterThanOrEqual(n));
  await sender().kick();
  return outboxRows();
};
const none = async () => {
  await new Promise((r) => setTimeout(r, 30));
  return expect(outboxRows()).toHaveLength(0);
};

beforeEach(() => {
  resetPush();
  relaySend.mockReset();
  relaySend.mockImplementation(async (b: { devices: unknown[] }) => ({
    kind: "results",
    results: b.devices.map(() => ({ status: "sent" })),
  }));
});
afterEach(() => vi.useRealTimers());

const link = (r: { payload: string }) => JSON.parse(r.payload).l;

describe("each event's category", () => {
  it("an ask raised is an asks push, once; refreshing the open ask is not another", async () => {
    pairPhone();
    const { workspace } = seedWorkspace();
    const { ask } = raiseAsk({
      workspaceId: workspace.id,
      subject: "brakes",
      kind: "gate",
      title: "Merge the auth change?",
    });
    const [row] = await rows(1);
    expect(row).toMatchObject({
      category: "asks",
      level: "time-sensitive",
      event_key: `ask:${ask.id}`,
    });
    expect(link(row)).toBe(`/orchestrator?workspaceId=${workspace.id}`);
    expect(row.payload).not.toContain("auth");
    const again = raiseAsk({
      workspaceId: workspace.id,
      subject: "brakes",
      kind: "gate",
      title: "Merge the auth change? (updated)",
    });
    expect(again.created).toBe(false);
    await new Promise((r) => setTimeout(r, 30));
    expect(outboxRows()).toHaveLength(1);
  });

  it("a session waiting on him for a minute is needs-you; answering sooner is nothing", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    pairPhone();
    noteWaiting("sess-a", true);
    await vi.advanceTimersByTimeAsync(59_000);
    noteWaiting("sess-a", false);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(outboxRows().map((r) => r.event_key)).toEqual([]);

    noteWaiting("sess-b", true);
    noteWaiting("sess-b", true); // a repeat doesn't restart the minute
    await vi.advanceTimersByTimeAsync(60_000);
    vi.useRealTimers();
    const [row] = await rows(1);
    expect(row).toMatchObject({ category: "needs-you", level: "active" });
    expect(link(row)).toBe("/session/sess-b");
    expect(row.event_key).toMatch(/^needs-you:sess-b:\d+$/);
  });

  it("review passed is review, a blocked review and failed CI are ci", async () => {
    pairPhone();
    events.pushReviewReady("task-1", "abc123");
    events.pushReviewBlocked("task-1", "abc123");
    events.pushCiFailed("task-2", "def456");
    const all = await rows(3);
    expect(all.map((r) => [r.category, r.event_key])).toEqual([
      ["review", "review:task-1:abc123"],
      ["ci", "review-block:task-1:abc123"],
      ["ci", "ci:task-2:def456"],
    ]);
    expect(all.map(link)).toEqual([
      "/task/task-1",
      "/task/task-1",
      "/task/task-2",
    ]);
  });

  it("merged is passive and off by default, on when the device asks for it", async () => {
    pairPhone();
    events.pushMerged("task-1");
    await none();
    resetPush();
    pairPhone(["merged"]);
    events.pushMerged("task-1");
    const [row] = await rows(1);
    expect(row).toMatchObject({ category: "merged", level: "passive" });
  });

  it("a plan ready for approval is review, and opens the task when it is one", async () => {
    pairPhone();
    db.prepare(
      `INSERT INTO sessions (id, name, tmux_name, working_directory, task_status) VALUES ('plan-task', 'p', 'p1', '/tmp', 'running')`
    ).run();
    db.prepare(
      `INSERT INTO sessions (id, name, tmux_name, working_directory) VALUES ('plan-chat', 'c', 'c1', '/tmp')`
    ).run();
    events.pushPlanReady("plan-task", "plan-1");
    events.pushPlanReady("plan-chat", "plan-2");
    const all = await rows(2);
    expect(all.map((r) => r.category)).toEqual(["review", "review"]);
    expect(all.map(link).sort()).toEqual(["/needs", "/task/plan-task"]);
    db.prepare(
      `DELETE FROM sessions WHERE id IN ('plan-task','plan-chat')`
    ).run();
  });
});

describe("PR changes (a task with no orchestrator)", () => {
  const pr = (checks: string) =>
    ({ number: 7, state: "OPEN", checks, head: "abc1234" }) as never;
  const session = (id: string, workspaceId: string | null) =>
    ({ id, workspace_id: workspaceId }) as never;

  it("CI failing is ci; CI green is ready for review", async () => {
    pairPhone();
    db.prepare(
      `INSERT INTO sessions (id, name, tmux_name, working_directory) VALUES ('pr-a', 'a', 'a1', '/tmp')`
    ).run();
    pushPrChange(session("pr-a", null), pr("fail"));
    pushPrChange(session("pr-a", null), pr("pass"));
    pushPrChange(session("pr-a", null), pr("pending"));
    const all = await rows(2);
    expect(all.map((r) => r.category)).toEqual(["ci", "review"]);
    db.prepare(`DELETE FROM sessions WHERE id = 'pr-a'`).run();
  });

  it("with an orchestrator, green is its review's call, but CI failing still pushes", async () => {
    pairPhone();
    const { workspace } = seedWorkspace();
    ensureOrchestrator(workspace.id);
    db.prepare(
      `INSERT INTO sessions (id, name, tmux_name, working_directory) VALUES ('pr-b', 'b', 'b1', '/tmp')`
    ).run();
    pushPrChange(session("pr-b", workspace.id), pr("pass"));
    await none();
    pushPrChange(session("pr-b", workspace.id), pr("fail"));
    expect((await rows(1)).map((r) => r.category)).toEqual(["ci"]);
    db.prepare(`DELETE FROM sessions WHERE id = 'pr-b'`).run();
  });

  it("the same head is pushed once however often it is seen", async () => {
    pairPhone();
    db.prepare(
      `INSERT INTO sessions (id, name, tmux_name, working_directory) VALUES ('pr-c', 'c', 'c1', '/tmp')`
    ).run();
    for (let i = 0; i < 3; i++) pushPrChange(session("pr-c", null), pr("fail"));
    await rows(1);
    await new Promise((r) => setTimeout(r, 30));
    expect(outboxRows()).toHaveLength(1);
    db.prepare(`DELETE FROM sessions WHERE id = 'pr-c'`).run();
  });
});
