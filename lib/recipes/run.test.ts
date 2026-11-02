import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../db";
import { makeRecipe, makeSession } from "./test-fixtures";

const started: { kind: string; opts: Record<string, unknown> }[] = [];
let fail: Error | null = null;

vi.mock("../tasks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../tasks")>()),
  createTask: async (opts: { id: string }) => {
    started.push({ kind: "task", opts });
    if (fail) throw fail;
    return { id: opts.id };
  },
}));
vi.mock("../sessions/launch", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../sessions/launch")>()),
  launchSession: async (opts: { id: string }) => {
    started.push({ kind: "session", opts });
    if (fail) throw fail;
    return { session: { id: opts.id } };
  },
}));

const { startRun, AlreadyRunning } = await import("./run");
const { setPaused } = await import("../orchestrator/pause");
const { BrakeRefused } = await import("../orchestrator/brakes");
const { liveRun } = await import("./store");

const settle = (id: number, status: string) =>
  db.prepare(`UPDATE recipe_runs SET status = ? WHERE id = ?`).run(status, id);

describe("startRun", () => {
  beforeEach(() => {
    started.length = 0;
    fail = null;
  });

  it("starts a fresh session with the composed prompt", async () => {
    const r = makeRecipe({ model: "anthropic/claude-sonnet-5-5" });
    const { run, queued } = await startRun(r.id, {
      trigger: "manual",
      note: "Includes #87",
    });
    expect(queued).toBe(false);
    expect(run).toMatchObject({ seq: 1, status: "running", trigger: "manual" });
    expect(started).toHaveLength(1);
    expect(started[0].kind).toBe("session");
    expect(started[0].opts).toMatchObject({
      name: "TestFlight build #1",
      id: run.session_id,
      startedBy: null,
    });
    expect(started[0].opts.prompt).toContain("Note for this run: Includes #87");
    expect(started[0].opts.prompt).toContain("RESULT: ok|failed");
    expect(run.prompt).toBe(started[0].opts.prompt);
  });

  it("starts a task for a task recipe, without a plan step", async () => {
    const r = makeRecipe({ kind: "task", name: "Audit" });
    await startRun(r.id, { trigger: "manual" });
    expect(started[0].kind).toBe("task");
    expect(started[0].opts).toMatchObject({ plan: false });
    expect(started[0].opts.prompt).toContain("Your PR is the deliverable");
  });

  it("runs one at a time: a second start names the live run", async () => {
    const r = makeRecipe();
    const first = await startRun(r.id, { trigger: "manual" });
    await expect(startRun(r.id, { trigger: "manual" })).rejects.toBeInstanceOf(
      AlreadyRunning
    );
    expect(started).toHaveLength(1);
    settle(first.run.id, "succeeded");
    const next = await startRun(r.id, { trigger: "manual" });
    expect(next.run.seq).toBe(2);
  });

  it("two starts at once make one run", async () => {
    const r = makeRecipe();
    const results = await Promise.allSettled([
      startRun(r.id, { trigger: "manual" }),
      startRun(r.id, { trigger: "manual" }),
    ]);
    expect(results.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    expect(started).toHaveLength(1);
  });

  it("returns the same run for a repeated request id", async () => {
    const r = makeRecipe();
    const a = await startRun(r.id, { trigger: "manual", requestId: "req-1" });
    const b = await startRun(r.id, { trigger: "manual", requestId: "req-1" });
    expect(b.run.id).toBe(a.run.id);
    expect(started).toHaveLength(1);
  });

  it("marks the run failed, and frees the slot, when the start throws", async () => {
    const r = makeRecipe();
    fail = new Error("no worktree");
    await expect(startRun(r.id, { trigger: "manual" })).rejects.toThrow(
      "no worktree"
    );
    expect(liveRun(r.id)).toBeNull();
    const row = db
      .prepare(`SELECT status, error FROM recipe_runs WHERE recipe_id = ?`)
      .get(r.id) as { status: string; error: string };
    expect(row).toEqual({ status: "failed", error: "no worktree" });
  });

  it("goes through the brakes when the orchestrator or a timer starts it", async () => {
    const r = makeRecipe();
    setPaused(r.workspace_id, true);
    await expect(startRun(r.id, { trigger: "tool" })).rejects.toBeInstanceOf(
      BrakeRefused
    );
    await expect(startRun(r.id, { trigger: "timer" })).rejects.toBeInstanceOf(
      BrakeRefused
    );
    expect(started).toHaveLength(0);
    const row = db
      .prepare(`SELECT status FROM recipe_runs WHERE recipe_id = ? ORDER BY id`)
      .all(r.id) as { status: string }[];
    expect(row.map((x) => x.status)).toEqual(["skipped", "skipped"]);
    // the owner's own Run is never held by the orchestrator's pause.
    const manual = await startRun(r.id, { trigger: "manual" });
    expect(manual.run.status).toBe("running");
  });

  it("is attributed to the orchestrator only when the orchestrator triggered it", async () => {
    const r = makeRecipe();
    const orch = makeSession({
      role: "orchestrator",
      workspace_id: r.workspace_id,
    });
    const { run } = await startRun(r.id, {
      trigger: "tool",
      actorSessionId: orch,
    });
    expect(started[0].opts.startedBy).toBe(orch);
    expect(run.triggered_by_session_id).toBe(orch);
  });
});
