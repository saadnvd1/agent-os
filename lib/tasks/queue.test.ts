import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "@/lib/db";
import { db } from "@/lib/db";
import { seedSession, seedWorkspace } from "@/lib/orchestrator/testing";
import { setPaused } from "@/lib/orchestrator/pause";
import { updateWorkspace } from "@/lib/workspaces";

// What was started, in order, by prompt and the id it was given.
const started: { prompt: string; id?: string }[] = [];

// A start makes a running task row with the id it was given, and nothing
// else: no worktree, no agent.
vi.mock("@/lib/tasks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tasks")>()),
  createTask: async (o: { id?: string; projectId: string; prompt: string }) => {
    started.push({ prompt: o.prompt, id: o.id });
    db.prepare(
      `INSERT INTO sessions (id, name, tmux_name, working_directory, project_id, task_status, branch_name)
       VALUES (?, ?, ?, '/tmp', ?, 'running', 'feature/x')`
    ).run(o.id, o.prompt, `claude-${o.id}`, o.projectId);
    return {
      id: o.id,
      name: o.prompt,
      branch_name: "feature/x",
    } as Session;
  },
}));

const {
  listQueue,
  moveQueued,
  planQueue,
  queueIfNeeded,
  recoverQueue,
  removeQueued,
  startQueuedNow,
  tickQueue,
} = await import("./queue");

const finish = (id: string, status = "merged") =>
  db
    .prepare(`UPDATE sessions SET task_status = ? WHERE id = ?`)
    .run(status, id);

const statusOf = (id: string) =>
  (
    db.prepare(`SELECT status FROM task_queue WHERE id = ?`).get(id) as {
      status: string;
    }
  ).status;

// Settles the background tick queueing set off, then looks once more.
async function tick() {
  await tickQueue();
  await tickQueue();
}

function setup(limit: number | null) {
  const t = seedWorkspace();
  updateWorkspace(t.workspace.id, { maxRunningTasks: limit });
  return t;
}

beforeEach(() => {
  started.length = 0;
  db.prepare(`UPDATE task_queue SET status = 'removed'`).run();
});

describe("the task queue", () => {
  it("starts as usual with no limit set and no after", () => {
    const t = setup(null);
    expect(queueIfNeeded({ projectId: t.app.id, prompt: "go" })).toBeNull();
  });

  it("queues over the limit and starts it once a slot frees", async () => {
    const t = setup(1); // seedWorkspace has one running task already
    const queued = queueIfNeeded({ projectId: t.app.id, prompt: "next" })!;
    expect(queued).toMatchObject({ status: "queued", position: 1 });
    await tick();
    expect(started).toEqual([]);
    finish(t.task);
    await tick();
    expect(started).toEqual([{ prompt: "next", id: queued.id }]);
    expect(statusOf(queued.id)).toBe("started");
    // Its id is the task's: the queue row and the session are one task.
    expect(listQueue().some((q) => q.id === queued.id)).toBe(false);
  });

  it("holds an after until its task finishes, then starts it", async () => {
    const t = setup(null);
    const queued = queueIfNeeded({
      projectId: t.app.id,
      prompt: "follow-up",
      after: "add-auth",
    })!;
    expect(queued.after).toBe("add-auth");
    await tick();
    expect(started).toEqual([]);
    finish(t.task, "dropped");
    await tick();
    expect(started.map((s) => s.prompt)).toEqual(["follow-up"]);
  });

  it("chains: an after on a queued task waits for that one to finish", async () => {
    const t = setup(null);
    const first = queueIfNeeded({
      projectId: t.app.id,
      prompt: "first",
      name: "first one",
      after: t.task,
    })!;
    const second = queueIfNeeded({
      projectId: t.app.id,
      prompt: "second",
      after: "first one",
    })!;
    finish(t.task);
    await tick();
    expect(started.map((s) => s.prompt)).toEqual(["first"]);
    expect(statusOf(second.id)).toBe("queued");
    finish(first.id, "done");
    await tick();
    expect(started.map((s) => s.prompt)).toEqual(["first", "second"]);
  });

  it("after any waits for whichever running task finishes first", async () => {
    const t = setup(null);
    const other = seedSession({ projectId: t.app.id, name: "b", task: true });
    queueIfNeeded({ projectId: t.app.id, prompt: "x", after: "any" });
    await tick();
    expect(started).toEqual([]);
    finish(other);
    await tick();
    expect(started.map((s) => s.prompt)).toEqual(["x"]);
  });

  it("refuses an after that names no running or queued task", () => {
    const t = setup(null);
    expect(() =>
      queueIfNeeded({ projectId: t.app.id, prompt: "x", after: "nope" })
    ).toThrow(/No running or queued task matches "nope"/);
  });

  it("Pause stops auto-starts; start now still goes", async () => {
    const t = setup(1);
    const queued = queueIfNeeded({ projectId: t.app.id, prompt: "p" })!;
    setPaused(t.workspace.id, true);
    finish(t.task);
    await tick();
    expect(started).toEqual([]);
    expect(listQueue().find((q) => q.id === queued.id)?.note).toMatch(/paused/);
    expect(await startQueuedNow(queued.id)).toBe("started");
    expect(started.map((s) => s.prompt)).toEqual(["p"]);
    setPaused(t.workspace.id, false);
  });

  it("starts in line order, one slot at a time, and can be reordered", async () => {
    const t = setup(1);
    const a = queueIfNeeded({ projectId: t.app.id, prompt: "a" })!;
    const b = queueIfNeeded({ projectId: t.api.id, prompt: "b" })!;
    const c = queueIfNeeded({ projectId: t.app.id, prompt: "c" })!;
    expect([a, b, c].map((q) => q.position)).toEqual([1, 2, 3]);
    moveQueued(c.id, -1);
    expect(
      listQueue()
        .filter((q) => [a.id, b.id, c.id].includes(q.id))
        .map((q) => q.name)
    ).toEqual(["a", "c", "b"]);
    finish(t.task);
    await tick();
    expect(started.map((s) => s.prompt)).toEqual(["a"]);
    finish(a.id);
    await tick();
    finish(c.id);
    await tick();
    expect(started.map((s) => s.prompt)).toEqual(["a", "c", "b"]);
  });

  it("a new task waits behind a line already waiting for a slot", () => {
    const t = setup(2);
    queueIfNeeded({ projectId: t.app.id, prompt: "x", after: t.task });
    // One running of two, but nothing waits for a slot: it starts.
    expect(queueIfNeeded({ projectId: t.app.id, prompt: "y" })).toBeNull();
    db.prepare(`UPDATE workspaces SET max_running_tasks = 1 WHERE id = ?`).run(
      t.workspace.id
    );
    expect(queueIfNeeded({ projectId: t.app.id, prompt: "z" })).not.toBeNull();
    db.prepare(`UPDATE workspaces SET max_running_tasks = 2 WHERE id = ?`).run(
      t.workspace.id
    );
    // A slot is free, but "z" is waiting for one: this goes behind it.
    expect(queueIfNeeded({ projectId: t.app.id, prompt: "w" })).not.toBeNull();
  });

  it("removed tasks never start", async () => {
    const t = setup(1);
    const q = queueIfNeeded({ projectId: t.app.id, prompt: "gone" })!;
    removeQueued(q.id);
    finish(t.task);
    await tick();
    expect(started).toEqual([]);
    expect(statusOf(q.id)).toBe("removed");
  });

  it("keeps the line across a restart, and never starts one twice", async () => {
    const t = setup(1);
    const kept = queueIfNeeded({ projectId: t.app.id, prompt: "kept" })!;
    const cut = queueIfNeeded({ projectId: t.app.id, prompt: "cut" })!;
    const made = queueIfNeeded({ projectId: t.app.id, prompt: "made" })!;
    // A restart between the claim and the task, and one just after it.
    db.prepare(
      `UPDATE task_queue SET status = 'starting' WHERE id IN (?, ?)`
    ).run(cut.id, made.id);
    seedSession({ projectId: t.app.id, name: "made", task: true });
    db.prepare(
      `UPDATE sessions SET id = ? WHERE name = 'made' AND project_id = ?`
    ).run(made.id, t.app.id);
    recoverQueue();
    expect(statusOf(kept.id)).toBe("queued");
    expect(statusOf(cut.id)).toBe("queued");
    expect(statusOf(made.id)).toBe("started");
  });
});

describe("planQueue", () => {
  const row = (id: string, workspace: string | null, status = "queued") =>
    ({
      id,
      project_id: `p-${id}`,
      workspace_id: workspace,
      status,
    }) as Parameters<typeof planQueue>[0][number];

  it("fills each workspace's slots in order, skipping one not ready", () => {
    const rows = [
      row("a", "w1"),
      row("b", "w1"),
      row("c", "w1"),
      row("d", "w2"),
      row("e", null),
    ];
    const plan = planQueue(
      rows,
      (s) => (s.workspaceId === "w1" ? 1 : 0),
      (w) => (w === "w1" ? 2 : w === "w2" ? 0 : null),
      (r) => r.id !== "a"
    );
    expect(plan).toEqual(["b", "e"]);
  });

  it("counts a row being started as in flight", () => {
    const plan = planQueue(
      [row("a", "w1", "starting"), row("b", "w1")],
      () => 0,
      () => 1,
      () => true
    );
    expect(plan).toEqual([]);
  });
});
