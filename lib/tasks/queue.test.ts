import { randomUUID } from "crypto";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "@/lib/db";
import { db, insertSessionRow, updateSessionRow } from "@/lib/db";
import { changeWatcher } from "@/lib/db/changes";
import {
  seedOrchestrator,
  seedSession,
  seedWorkspace,
} from "@/lib/orchestrator/testing";
import { resetMachineStarts } from "@/lib/load/start-gate";
import { setPaused } from "@/lib/orchestrator/pause";
import { updateWorkspace } from "@/lib/workspaces";
import type { MachineView } from "./schedule";

// What was started, in order, by prompt and the id it was given.
const started: { prompt: string; id?: string }[] = [];
const startedPlanOnly = new Map<string, boolean>();
// The machine each start was sent to, by prompt (undefined: the project's).
const startedOn = new Map<string, string | undefined>();
// Linked machines the placing pass sees: set per test.
let peers: Record<
  string,
  {
    level: "green" | "red";
    stale?: boolean;
    hasProject?: boolean;
    // An older AgentOS: it can't hold an orchestrator's task.
    noHold?: boolean;
    // It runs a plan step that stops for this machine.
    plans?: boolean;
  }
> = {};

// A start makes a running task row with the id it was given, and nothing
// else: no worktree, no agent.
vi.mock("@/lib/tasks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tasks")>()),
  createTask: async (o: {
    id?: string;
    projectId: string;
    prompt: string;
    hostId?: string;
    planOnly?: boolean;
  }) => {
    started.push({ prompt: o.prompt, id: o.id });
    startedPlanOnly.set(o.prompt, !!o.planOnly);
    startedOn.set(o.prompt, o.hostId);
    if (o.prompt.startsWith("fail")) throw new Error("no worktree");
    insertSessionRow(db, {
      id: o.id as string,
      name: o.prompt,
      tmux_name: `claude-${o.id}`,
      working_directory: "/tmp",
      project_id: o.projectId,
      task_status: "running",
      branch_name: "feature/x",
    });
    // The row is written, then the agent's launch fails.
    if (o.prompt.startsWith("half")) throw new Error("agent did not launch");
    return {
      id: o.id,
      name: o.prompt,
      branch_name: "feature/x",
    } as Session;
  },
}));

// The usage window, as the brakes read it (only while they're on).
let windowReason: string | null = null;
vi.mock("@/lib/orchestrator/usage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/orchestrator/usage")>()),
  readUsage: () => ({ window: null }),
  windowRefusal: () => windowReason,
}));

// The machine as the scheduler sees it: calm and idle unless a test says so.
const greenView = (): MachineView => ({
  label: "this machine",
  enabled: true,
  reading: false,
  level: "green",
  settled: true,
  settleLeftMs: 0,
  booted: 0,
  maxBooted: 2,
  heavyStarting: 0,
  lastAutoStartAt: null,
  lastHeavyStartAt: null,
});
let machine: MachineView = greenView();
let capabilities = ["mac", "xcode", "simulator"];
const recorded: { hostId: string; heavy: boolean }[] = [];
vi.mock("@/lib/load/machines", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/load/machines")>()),
  localView: () => machine,
  machineCapabilities: () => capabilities,
  recordAutoStart: (hostId: string, heavy: boolean) => {
    recorded.push({ hostId, heavy });
  },
}));

vi.mock("@/lib/hosts/remote-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/hosts/remote-api")>()),
  linkedHostIds: () => new Set(Object.keys(peers)),
  hostLink: (id: string) => (peers[id] ? { hostId: id } : null),
}));
vi.mock("@/lib/tasks/contract/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tasks/contract/client")>()),
  list: async (link: { hostId: string }) => ({
    tasks: [],
    capabilities: [
      ...(peers[link.hostId]?.noHold ? [] : ["held-start"]),
      ...(peers[link.hostId]?.plans ? ["remote-plan"] : []),
    ],
  }),
}));
vi.mock("@/lib/hosts/project-machines", () => ({
  projectMachines: async () =>
    Object.fromEntries(
      Object.entries(peers).map(([id, p]) => [
        id,
        p.hasProject === false ? "not there" : null,
      ])
    ),
}));
vi.mock("@/lib/hosts/peer-load", () => ({
  refreshPeers: async (ids: string[], now: number) => {
    const { feedGate } = await import("@/lib/load/start-gate");
    for (const id of ids)
      if (peers[id] && !peers[id].stale) feedGate(id, peers[id].level, now);
  },
  peerReading: (id: string) =>
    peers[id] ? { load1: 1, cores: 8, level: peers[id].level } : null,
  peerSource: (id: string) => ({
    hostId: id,
    label: id,
    level: peers[id]?.level ?? null,
    booted: 0,
    maxBooted: 2,
    capabilities: ["linux"],
    stale: !!peers[id]?.stale,
  }),
}));

const {
  findQueued,
  listQueue,
  moveQueued,
  queueIfNeeded,
  recoverQueue,
  removeQueued,
  setPriority,
  startOrQueue,
  startQueuedForOrchestrator,
  startQueuedNow,
  tickQueue,
} = await import("./queue");

const finish = (id: string, status = "merged") =>
  updateSessionRow(db, id, { task_status: status });

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
  recorded.length = 0;
  startedOn.clear();
  startedPlanOnly.clear();
  peers = {};
  machine = greenView();
  capabilities = ["mac", "xcode", "simulator"];
  resetMachineStarts();
  db.prepare(`UPDATE task_queue SET status = 'removed'`).run();
});

describe("the task queue", () => {
  it("starts as usual with no limit set and no after", () => {
    const t = setup(null);
    expect(
      queueIfNeeded({ startedVia: "person", projectId: t.app.id, prompt: "go" })
    ).toBeNull();
  });

  it("keeps plan only while a task waits", () => {
    const t = setup(1);
    const q = queueIfNeeded({
      startedVia: "person",
      projectId: t.app.id,
      prompt: "plan it",
      planOnly: true,
      after: t.task,
    })!;
    expect(
      db.prepare(`SELECT plan_only FROM task_queue WHERE id = ?`).get(q.id)
    ).toEqual({ plan_only: 1 });
  });

  it("keeps the plan decision and who started it while a task waits", () => {
    const t = setup(1);
    const q = queueIfNeeded({
      startedVia: "person",
      projectId: t.app.id,
      prompt: "decided",
      plan: false,
      planReason: "one-line default change",
      startedBy: "orch-1",
    })!;
    expect(
      db
        .prepare(
          `SELECT plan, plan_reason, started_by FROM task_queue WHERE id = ?`
        )
        .get(q.id)
    ).toEqual({
      plan: 0,
      plan_reason: "one-line default change",
      started_by: "orch-1",
    });
  });

  it("queues over the limit and starts it once a slot frees", async () => {
    const t = setup(1); // seedWorkspace has one running task already
    const queued = queueIfNeeded({
      startedVia: "person",
      projectId: t.app.id,
      prompt: "next",
    })!;
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
      startedVia: "person",
      projectId: t.app.id,
      prompt: "follow-up",
      after: "add-auth",
    })!;
    // The sidebar links the wait to its task and files it by workspace.
    expect(queued).toMatchObject({
      after: "add-auth",
      afterId: t.task,
      workspaceId: t.workspace.id,
    });
    await tick();
    expect(started).toEqual([]);
    finish(t.task, "dropped");
    await tick();
    expect(started.map((s) => s.prompt)).toEqual(["follow-up"]);
  });

  it("chains: an after on a queued task waits for that one to finish", async () => {
    const t = setup(null);
    const first = queueIfNeeded({
      startedVia: "person",
      projectId: t.app.id,
      prompt: "first",
      name: "first one",
      after: t.task,
    })!;
    const second = queueIfNeeded({
      startedVia: "person",
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
    queueIfNeeded({
      startedVia: "person",
      projectId: t.app.id,
      prompt: "x",
      after: "any",
    });
    await tick();
    expect(started).toEqual([]);
    finish(other);
    await tick();
    expect(started.map((s) => s.prompt)).toEqual(["x"]);
  });

  it("after any starts at once when nothing is running", async () => {
    const t = setup(null);
    finish(t.task);
    expect(
      queueIfNeeded({
        startedVia: "person",
        projectId: t.app.id,
        prompt: "x",
        after: "any",
      })
    ).toBeNull();
    const out = await startOrQueue(
      { startedVia: "person", projectId: t.app.id, prompt: "x", after: "any" },
      async () => "go"
    );
    expect(out).toEqual({ started: "go" });
  });

  it("after any doesn't wait on a running task whose PR is already closed", async () => {
    const t = setup(null);
    updateSessionRow(db, t.task, { pr_status: "closed" });
    expect(
      queueIfNeeded({
        startedVia: "person",
        projectId: t.app.id,
        prompt: "x",
        after: "any",
      })
    ).toBeNull();
    const live = seedSession({ projectId: t.app.id, name: "live", task: true });
    const q = queueIfNeeded({
      startedVia: "person",
      projectId: t.app.id,
      prompt: "y",
      after: "any",
    })!;
    await tick();
    expect(started).toEqual([]);
    // The other one's PR closing frees a waiting row too.
    updateSessionRow(db, live, { pr_status: "merged" });
    await tick();
    expect(started.map((s) => s.prompt)).toEqual(["y"]);
    expect(statusOf(q.id)).toBe("started");
  });

  it("removes a queued task by its id before it starts", async () => {
    const t = setup(1);
    const q = queueIfNeeded({
      startedVia: "person",
      projectId: t.app.id,
      prompt: "p",
    })!;
    expect(findQueued(t.workspace.id, q.id.slice(0, 8))?.id).toBe(q.id);
    removeQueued(q.id);
    expect(findQueued(t.workspace.id, q.id)).toBeNull();
    finish(t.task);
    await tick();
    expect(started).toEqual([]);
  });

  it("refuses an after that names no running or queued task", () => {
    const t = setup(null);
    expect(() =>
      queueIfNeeded({
        startedVia: "person",
        projectId: t.app.id,
        prompt: "x",
        after: "nope",
      })
    ).toThrow(/No running or queued task matches "nope"/);
  });

  it("Pause stops auto-starts; start now still goes", async () => {
    const t = setup(1);
    const queued = queueIfNeeded({
      startedVia: "person",
      projectId: t.app.id,
      prompt: "p",
    })!;
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
    const a = queueIfNeeded({
      startedVia: "person",
      projectId: t.app.id,
      prompt: "a",
    })!;
    const b = queueIfNeeded({
      startedVia: "person",
      projectId: t.api.id,
      prompt: "b",
    })!;
    const c = queueIfNeeded({
      startedVia: "person",
      projectId: t.app.id,
      prompt: "c",
    })!;
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
    queueIfNeeded({
      startedVia: "person",
      projectId: t.app.id,
      prompt: "x",
      after: t.task,
    });
    // One running of two, but nothing waits for a slot: it starts.
    expect(
      queueIfNeeded({ startedVia: "person", projectId: t.app.id, prompt: "y" })
    ).toBeNull();
    db.prepare(`UPDATE workspaces SET max_running_tasks = 1 WHERE id = ?`).run(
      t.workspace.id
    );
    expect(
      queueIfNeeded({ startedVia: "person", projectId: t.app.id, prompt: "z" })
    ).not.toBeNull();
    db.prepare(`UPDATE workspaces SET max_running_tasks = 2 WHERE id = ?`).run(
      t.workspace.id
    );
    // A slot is free, but "z" is waiting for one: this goes behind it.
    expect(
      queueIfNeeded({ startedVia: "person", projectId: t.app.id, prompt: "w" })
    ).not.toBeNull();
  });

  it("removed tasks never start", async () => {
    const t = setup(1);
    const q = queueIfNeeded({
      startedVia: "person",
      projectId: t.app.id,
      prompt: "gone",
    })!;
    removeQueued(q.id);
    finish(t.task);
    await tick();
    expect(started).toEqual([]);
    expect(statusOf(q.id)).toBe("removed");
  });

  it("keeps the line across a restart, and never starts one twice", async () => {
    const t = setup(1);
    const kept = queueIfNeeded({
      startedVia: "person",
      projectId: t.app.id,
      prompt: "kept",
    })!;
    const cut = queueIfNeeded({
      startedVia: "person",
      projectId: t.app.id,
      prompt: "cut",
    })!;
    const made = queueIfNeeded({
      startedVia: "person",
      projectId: t.app.id,
      prompt: "made",
    })!;
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
    // The line carries on in order, and "made" is never started again.
    for (const id of [t.task, made.id]) finish(id);
    await tick();
    finish(kept.id);
    await tick();
    expect(started.map((s) => s.id)).toEqual([kept.id, cut.id]);
    const sessions = db
      .prepare(`SELECT COUNT(*) AS n FROM sessions WHERE id = ?`)
      .get(made.id) as { n: number };
    expect(sessions.n).toBe(1);
  });

  it("retries a failed start twice, then shows it failed", async () => {
    const t = setup(null);
    const q = queueIfNeeded({
      startedVia: "person",
      projectId: t.app.id,
      prompt: "fail to start",
      after: t.task,
    })!;
    finish(t.task);
    for (const attempt of [1, 2]) {
      await tick();
      const row = db
        .prepare(`SELECT status, attempts, error FROM task_queue WHERE id = ?`)
        .get(q.id) as { status: string; attempts: number; error: string };
      expect(row.attempts).toBeGreaterThanOrEqual(attempt);
    }
    await tick();
    await tick();
    const row = db
      .prepare(`SELECT status, attempts, error FROM task_queue WHERE id = ?`)
      .get(q.id) as { status: string; attempts: number; error: string };
    expect(row).toMatchObject({ status: "failed", attempts: 3 });
    expect(row.error).toMatch(/^Could not start: no worktree/);
    expect(started.filter((s) => s.id === q.id)).toHaveLength(3);
    expect(listQueue().find((v) => v.id === q.id)?.status).toBe("failed");
  });

  it("a start whose task row exists but whose agent failed counts as started", async () => {
    const t = setup(null);
    const q = queueIfNeeded({
      startedVia: "person",
      projectId: t.app.id,
      prompt: "half started",
      after: t.task,
    })!;
    finish(t.task);
    await tick();
    await tick();
    expect(statusOf(q.id)).toBe("started");
    expect(started.filter((s) => s.id === q.id)).toHaveLength(1);
  });

  it("holds auto-starts while the usage window would run out", async () => {
    const t = setup(1);
    const q = queueIfNeeded({
      startedVia: "person",
      projectId: t.app.id,
      prompt: "later",
    })!;
    process.env.AGENTOS_ORCH_BRAKES = "1";
    windowReason = "the 5h window runs out before it resets";
    try {
      finish(t.task);
      await tick();
      expect(started).toEqual([]);
      expect(listQueue().find((v) => v.id === q.id)?.note).toBe(
        "Waiting: the 5h window runs out before it resets"
      );
      windowReason = null;
      await tick();
      expect(started.map((s) => s.id)).toEqual([q.id]);
    } finally {
      delete process.env.AGENTOS_ORCH_BRAKES;
      windowReason = null;
    }
  });

  it("POST /api/tasks queues over the limit, but never another machine's keyed start", async () => {
    const t = setup(1);
    const { POST } = await import("@/app/api/tasks/route");
    const post = (body: object) =>
      POST(
        new NextRequest("http://127.0.0.1:3011/api/tasks", {
          method: "POST",
          body: JSON.stringify({ projectId: t.app.id, prompt: "p", ...body }),
        })
      );
    const queued = await post({});
    expect(queued.status).toBe(202);
    expect((await queued.json()).queued).toMatchObject({ status: "queued" });
    const id = randomUUID();
    const keyed = await post({ id });
    expect(keyed.status).toBe(201);
    expect((await keyed.json()).session.id).toBe(id);
    expect(
      db.prepare(`SELECT id FROM task_queue WHERE id = ?`).get(id)
    ).toBeUndefined();
  });
});

// Every change to the line moves the task_queue topic, which the browser
// refetches the list from (data/push/topics.ts).
describe("queue changes reach the browser", () => {
  const watch = changeWatcher(() => db);
  const moved = (change: () => unknown) => {
    watch();
    change();
    return watch();
  };

  it("enqueue, reorder, remove and start each move task_queue", async () => {
    const t = setup(1);
    const a = moved(() =>
      queueIfNeeded({ startedVia: "person", projectId: t.app.id, prompt: "a" })
    );
    expect(a).toContain("task_queue");
    const first = listQueue().find((q) => q.name === "a")!;
    const second = queueIfNeeded({
      startedVia: "person",
      projectId: t.app.id,
      prompt: "b",
    })!;
    expect(moved(() => moveQueued(second.id, -1))).toContain("task_queue");
    expect(moved(() => removeQueued(second.id))).toContain("task_queue");
    finish(t.task);
    watch();
    await tick();
    expect(statusOf(first.id)).toBe("started");
    expect(watch()).toContain("task_queue");
  });

  it("a start now, an after-any start at once, and a failed start move it", async () => {
    const t = setup(1);
    const now = queueIfNeeded({
      startedVia: "person",
      projectId: t.app.id,
      prompt: "now",
    })!;
    watch();
    await startQueuedNow(now.id);
    expect(watch()).toContain("task_queue");
    const failing = queueIfNeeded({
      startedVia: "person",
      projectId: t.app.id,
      prompt: "fail now",
    })!;
    watch();
    await startQueuedNow(failing.id).catch(() => {});
    expect(watch()).toContain("task_queue");
  });
});

describe("starting directly", () => {
  it("holds the slot until the task exists, so two starts at once can't both take it", async () => {
    const t = seedWorkspace();
    updateWorkspace(t.workspace.id, { maxRunningTasks: 2 });
    let release!: () => void;
    const slow = new Promise<void>((r) => (release = r));
    const first = startOrQueue(
      { startedVia: "person", projectId: t.app.id, prompt: "a" },
      () => slow.then(() => "a")
    );
    const second = await startOrQueue(
      { startedVia: "person", projectId: t.app.id, prompt: "b" },
      async () => "b"
    );
    expect(second).toHaveProperty("queued");
    release();
    expect(await first).toEqual({ started: "a" });
  });
});

describe("a slot held by a direct start", () => {
  it("is given back when the start fails", async () => {
    const t = seedWorkspace();
    updateWorkspace(t.workspace.id, { maxRunningTasks: 2 });
    await expect(
      startOrQueue(
        { startedVia: "person", projectId: t.app.id, prompt: "a" },
        async () => {
          throw new Error("braked");
        }
      )
    ).rejects.toThrow("braked");
    expect(
      await startOrQueue(
        { startedVia: "person", projectId: t.app.id, prompt: "b" },
        async () => "b"
      )
    ).toEqual({ started: "b" });
  });

  it("keeps the tick from starting a queued task into it", async () => {
    const t = seedWorkspace();
    updateWorkspace(t.workspace.id, { maxRunningTasks: 2 });
    const waiting = queueIfNeeded({
      startedVia: "person",
      projectId: t.app.id,
      prompt: "waits",
      after: t.task,
    })!;
    seedSession({ projectId: t.app.id, name: "other", task: true });
    let release!: () => void;
    const slow = new Promise<void>((r) => (release = r));
    finish(t.task); // its after is met; one running, one direct start
    const direct = startOrQueue(
      { startedVia: "person", projectId: t.api.id, prompt: "d" },
      () => slow.then(() => "d")
    );
    await tick();
    expect(started).toEqual([]);
    release();
    await direct;
    await tick();
    // The direct start never made a row here, so its slot is free again.
    expect(started.map((s) => s.id)).toEqual([waiting.id]);
  });
});

describe("a keyed retry's leftovers", () => {
  it("are only cleared when no task has that worktree or branch", async () => {
    const { ownedByATask } = await import("./index");
    const { worktreePathFor } = await import("@/lib/worktrees");
    const t = seedWorkspace();
    const feature = "fix-login-ab12";
    expect(ownedByATask(t.app.id, "/tmp/app", feature)).toBe(false);
    const byBranch = seedSession({
      projectId: t.app.id,
      name: "b",
      task: true,
    });
    db.prepare(`UPDATE sessions SET branch_name = ? WHERE id = ?`).run(
      `feature/${feature}`,
      byBranch
    );
    expect(ownedByATask(t.app.id, "/tmp/app", feature)).toBe(true);
    expect(ownedByATask(t.api.id, "/tmp/api", feature)).toBe(false);
    const byPath = seedSession({ projectId: t.api.id, name: "p", task: true });
    db.prepare(`UPDATE sessions SET worktree_path = ? WHERE id = ?`).run(
      worktreePathFor("/tmp/api", feature),
      byPath
    );
    expect(ownedByATask(t.api.id, "/tmp/api", feature)).toBe(true);
  });
});

const waitOf = (id: string) =>
  db.prepare(`SELECT note, wait_code FROM task_queue WHERE id = ?`).get(id) as {
    note: string | null;
    wait_code: string | null;
  };

describe("priority and score", () => {
  it("stores a priority, defaulting to normal", () => {
    const t = setup(1);
    const a = queueIfNeeded({
      startedVia: "person",
      projectId: t.app.id,
      prompt: "a",
    })!;
    const b = queueIfNeeded({
      startedVia: "person",
      projectId: t.app.id,
      prompt: "b",
      priority: "urgent",
    })!;
    expect(a.priority).toBe("normal");
    expect(b.priority).toBe("urgent");
    expect(() =>
      queueIfNeeded({
        startedVia: "person",
        projectId: t.app.id,
        prompt: "c",
        priority: "whenever" as never,
      })
    ).toThrow(/Priority is one of/);
  });

  it("starts the higher priority first, whatever the line order", async () => {
    const t = setup(1);
    queueIfNeeded({
      startedVia: "person",
      projectId: t.app.id,
      prompt: "plain",
    });
    queueIfNeeded({
      startedVia: "person",
      projectId: t.app.id,
      prompt: "later",
      priority: "background",
    });
    queueIfNeeded({
      startedVia: "person",
      projectId: t.app.id,
      prompt: "bug",
      priority: "urgent",
    });
    finish(t.task);
    await tick();
    expect(started.map((s) => s.prompt)).toEqual(["bug"]);
  });

  it("a priority change reorders the line and keeps the task's age", async () => {
    const t = setup(1);
    const a = queueIfNeeded({
      startedVia: "person",
      projectId: t.app.id,
      prompt: "first",
    })!;
    const b = queueIfNeeded({
      startedVia: "person",
      projectId: t.app.id,
      prompt: "second",
    })!;
    expect(listQueue().find((q) => q.id === b.id)).toMatchObject({
      rank: 2,
      of: 2,
    });
    setPriority(b.id, "blocking");
    expect(listQueue().find((q) => q.id === b.id)).toMatchObject({
      rank: 1,
      priority: "blocking",
    });
    expect(listQueue().find((q) => q.id === a.id)!.rank).toBe(2);
    const created = db
      .prepare(`SELECT created_at FROM task_queue WHERE id = ?`)
      .get(b.id);
    setPriority(b.id, "normal");
    expect(
      db.prepare(`SELECT created_at FROM task_queue WHERE id = ?`).get(b.id)
    ).toEqual(created);
    expect(() => setPriority("nope", "urgent")).toThrow(/No such/);
  });

  it("changes a running task's priority too", () => {
    const t = setup(null);
    setPriority(t.task, "blocking");
    expect(
      db.prepare(`SELECT priority FROM session_rows WHERE id = ?`).get(t.task)
    ).toEqual({ priority: "blocking" });
  });

  it("a paused task gives its slot back", async () => {
    const t = setup(1);
    const q = queueIfNeeded({
      startedVia: "person",
      projectId: t.app.id,
      prompt: "next",
    })!;
    await tick();
    expect(started).toEqual([]);
    updateSessionRow(db, t.task, { pause_state: "paused" });
    await tick();
    expect(started.map((s) => s.prompt)).toEqual(["next"]);
    expect(statusOf(q.id)).toBe("started");
  });
});

describe("after any consumes a finish", () => {
  it("one finish releases one waiter, the next finish the next", async () => {
    const t = setup(null);
    const b = seedSession({ projectId: t.app.id, name: "b", task: true });
    const c = seedSession({ projectId: t.app.id, name: "c", task: true });
    const waiters = ["w1", "w2", "w3"].map((p) =>
      queueIfNeeded({
        startedVia: "person",
        projectId: t.app.id,
        prompt: p,
        after: "any",
      })!
    );
    finish(t.task);
    await tick();
    expect(started.map((s) => s.prompt)).toEqual(["w1"]);
    expect(waitOf(waiters[1].id)).toMatchObject({ wait_code: "after_any" });
    expect(waitOf(waiters[1].id).note).toMatch(/after any running task/);
    finish(b);
    await tick();
    expect(started.map((s) => s.prompt)).toEqual(["w1", "w2"]);
    finish(c);
    await tick();
    expect(started.map((s) => s.prompt)).toEqual(["w1", "w2", "w3"]);
  });

  it("the unique index refuses a finish used twice", () => {
    const t = setup(null);
    const a = queueIfNeeded({
      startedVia: "person",
      projectId: t.app.id,
      prompt: "a",
      after: "any",
    })!;
    const b = queueIfNeeded({
      startedVia: "person",
      projectId: t.app.id,
      prompt: "b",
      after: "any",
    })!;
    db.prepare(`UPDATE task_queue SET after_any_used = 'x' WHERE id = ?`).run(
      a.id
    );
    expect(() =>
      db
        .prepare(`UPDATE task_queue SET after_any_used = 'x' WHERE id = ?`)
        .run(b.id)
    ).toThrow(/UNIQUE/);
  });

  it("two finishes at once release two waiters, one start per look", async () => {
    const t = setup(null);
    const b = seedSession({ projectId: t.app.id, name: "b", task: true });
    queueIfNeeded({
      startedVia: "person",
      projectId: t.app.id,
      prompt: "w1",
      after: "any",
    });
    queueIfNeeded({
      startedVia: "person",
      projectId: t.app.id,
      prompt: "w2",
      after: "any",
    });
    await tickQueue();
    finish(t.task);
    finish(b);
    await tickQueue();
    expect(started.map((s) => s.prompt)).toEqual(["w1"]);
    await tickQueue();
    expect(started.map((s) => s.prompt)).toEqual(["w1", "w2"]);
  });

  it("recoverQueue keeps the finish a cut-off start had taken", () => {
    const t = setup(null);
    const q = queueIfNeeded({
      startedVia: "person",
      projectId: t.app.id,
      prompt: "cut",
      after: "any",
    })!;
    db.prepare(
      `UPDATE task_queue SET status = 'starting', after_any_used = 'r9' WHERE id = ?`
    ).run(q.id);
    recoverQueue();
    expect(
      db
        .prepare(`SELECT status, after_any_used FROM task_queue WHERE id = ?`)
        .get(q.id)
    ).toEqual({ status: "queued", after_any_used: "r9" });
  });
});

describe("machine load", () => {
  const afterTask = (t: ReturnType<typeof setup>, prompt: string, extra = {}) =>
    queueIfNeeded({
      startedVia: "person",
      projectId: t.app.id,
      prompt,
      after: t.task,
      ...extra,
    })!;

  it("holds starts while the machine is red, and says so once", async () => {
    const t = setup(null);
    const q = afterTask(t, "held");
    finish(t.task);
    machine = { ...greenView(), level: "red", settled: false };
    await tick();
    expect(started).toEqual([]);
    expect(waitOf(q.id)).toEqual({
      note: "Waiting: this machine load red",
      wait_code: "load_red",
    });
    machine = greenView();
    await tick();
    expect(started.map((s) => s.prompt)).toEqual(["held"]);
    expect(waitOf(q.id)).toEqual({ note: null, wait_code: null });
  });

  it("on amber only blocking and urgent work starts", async () => {
    const t = setup(null);
    afterTask(t, "plain");
    afterTask(t, "bug", { priority: "urgent" });
    finish(t.task);
    machine = { ...greenView(), level: "amber" };
    await tick();
    expect(started.map((s) => s.prompt)).toEqual(["bug"]);
  });

  it("holds a simulator task when the simulators are in use", async () => {
    const t = setup(null);
    const q = afterTask(t, "ios");
    db.prepare(`UPDATE task_queue SET machine_needs = ? WHERE id = ?`).run(
      JSON.stringify(["mac", "xcode", "simulator"]),
      q.id
    );
    finish(t.task);
    machine = { ...greenView(), booted: 2 };
    await tick();
    expect(started).toEqual([]);
    expect(waitOf(q.id)).toMatchObject({ wait_code: "heavy" });
    machine = { ...greenView(), booted: 0 };
    await tick();
    expect(started.map((s) => s.prompt)).toEqual(["ios"]);
    expect(recorded).toEqual([{ hostId: "local", heavy: true }]);
  });

  it("spaces automatic starts: one per look on a machine", async () => {
    const t = setup(null);
    afterTask(t, "one");
    afterTask(t, "two");
    // The look queueing set off ends first, so the next one is the only one.
    await tickQueue();
    finish(t.task);
    await tickQueue();
    expect(started.map((s) => s.prompt)).toEqual(["one"]);
    await tickQueue();
    expect(started.map((s) => s.prompt)).toEqual(["one", "two"]);
  });

  it("an orchestrator's own start waits out a red machine; a person's goes", () => {
    const t = setup(null);
    machine = { ...greenView(), level: "red", settled: false };
    expect(
      queueIfNeeded({
        startedVia: "person",
        projectId: t.app.id,
        prompt: "person",
      })
    ).toBeNull();
    expect(
      queueIfNeeded({
        startedVia: "person",
        projectId: t.app.id,
        prompt: "orch",
        originWorkspaceId: t.workspace.id,
      })
    ).toMatchObject({ status: "queued" });
  });

  it("Start now ignores the load", async () => {
    const t = setup(null);
    const q = afterTask(t, "now");
    machine = { ...greenView(), level: "red", settled: false };
    expect(await startQueuedNow(q.id)).toBe("started");
  });
});

describe("placement on a linked machine", () => {
  const redHome = () => {
    machine = { ...greenView(), level: "red", settled: false };
  };
  const queue = (t: ReturnType<typeof setup>, prompt: string, extra = {}) =>
    queueIfNeeded({
      startedVia: "person",
      projectId: t.app.id,
      prompt,
      after: t.task,
      ...extra,
    })!;

  it("starts a held task on a green linked machine and says why", async () => {
    const t = setup(null);
    const q = queue(t, "move out");
    finish(t.task);
    redHome();
    peers = { box: { level: "green" } };
    await tick();
    expect(startedOn.get("move out")).toBe("box");
    expect(statusOf(q.id)).toBe("started");
    expect(
      db.prepare(`SELECT placed_note FROM session_rows WHERE id = ?`).get(q.id)
    ).toEqual({ placed_note: "Started on box · this machine load red" });
  });

  it("holds when the linked machine's reading is stale or it's red", async () => {
    const t = setup(null);
    const q = queue(t, "stay");
    finish(t.task);
    redHome();
    peers = { box: { level: "green", stale: true } };
    await tick();
    peers = { box: { level: "red" } };
    await tick();
    expect(started).toEqual([]);
    expect(waitOf(q.id).wait_code).toBe("load_red");
  });

  it("skips a linked machine without the project", async () => {
    const t = setup(null);
    queue(t, "no project there");
    finish(t.task);
    redHome();
    peers = { box: { level: "green", hasProject: false } };
    await tick();
    expect(started).toEqual([]);
  });

  it("never places a Mac task, however red the Mac is", async () => {
    const t = setup(null);
    const q = queue(t, "ios", { machine: "mac" });
    finish(t.task);
    redHome();
    peers = { box: { level: "green" } };
    await tick();
    expect(started).toEqual([]);
    expect(waitOf(q.id).wait_code).toBe("load_red");
  });

  it("starts a plan-only task at home under red load when no machine can plan it", async () => {
    const t = setup(null);
    const q = queue(t, "plan it", { planOnly: true });
    finish(t.task);
    redHome();
    peers = { box: { level: "green" } };
    await tick();
    expect(started.map((s) => s.prompt)).toEqual(["plan it"]);
    expect(startedOn.get("plan it")).toBeUndefined();
    expect(statusOf(q.id)).toBe("started");
  });

  it("places a plan-only task on a green machine that runs plans when this one is red", async () => {
    const t = setup(null);
    const q = queue(t, "plan it", { planOnly: true });
    finish(t.task);
    redHome();
    peers = { box: { level: "green", plans: true } };
    await tick();
    expect(startedOn.get("plan it")).toBe("box");
    expect(statusOf(q.id)).toBe("started");
    expect(startedPlanOnly.get("plan it")).toBe(true);
  });

  it("keeps a Mac-pinned plan-first task queued while the Mac is red, then starts it here", async () => {
    const t = setup(null);
    const q = queue(t, "plan first", { plan: true, machine: "mac" });
    finish(t.task);
    redHome();
    peers = { box: { level: "green", plans: true } };
    await tick();
    expect(started).toEqual([]);
    expect(statusOf(q.id)).toBe("queued");
    expect(waitOf(q.id).wait_code).toBe("load_red");
    machine = greenView();
    await tick();
    expect(startedOn.get("plan first")).toBeUndefined();
    expect(started.map((x) => x.prompt)).toEqual(["plan first"]);
    expect(statusOf(q.id)).toBe("started");
  });

  it("still places an unpinned plan-first task in the same state", async () => {
    const t = setup(null);
    queue(t, "plan first", { plan: true, machine: "any" });
    finish(t.task);
    redHome();
    peers = { box: { level: "green", plans: true } };
    await tick();
    expect(startedOn.get("plan first")).toBe("box");
  });

  it("holds a plan-first task when the only linked machine can't run plans", async () => {
    const t = setup(null);
    const q = queue(t, "plan first", { plan: true });
    finish(t.task);
    redHome();
    peers = { box: { level: "green" } };
    await tick();
    expect(started).toEqual([]);
    expect(waitOf(q.id).wait_code).toBe("load_red");
  });

  it("holds a plan-first task when that machine is red too", async () => {
    const t = setup(null);
    queue(t, "plan first", { plan: true });
    finish(t.task);
    redHome();
    peers = { box: { level: "red", plans: true } };
    await tick();
    expect(started).toEqual([]);
  });

  it("starts a plan-first task at home on a green machine, placing nothing", async () => {
    const t = setup(null);
    queue(t, "plan first", { plan: true });
    finish(t.task);
    peers = { box: { level: "green", plans: true } };
    await tick();
    expect(startedOn.get("plan first")).toBeUndefined();
  });

  it("holds a plan-only task on its after dependency, with no load wait", async () => {
    const t = setup(null);
    const q = queue(t, "plan it", { planOnly: true });
    redHome();
    await tick();
    expect(started).toEqual([]);
    expect(waitOf(q.id).wait_code).toBe("after");
  });

  it("holds a plan-only task while the orchestrator is paused", async () => {
    const t = setup(null);
    const q = queue(t, "plan it", { planOnly: true });
    finish(t.task);
    setPaused(t.workspace.id, true);
    await tick();
    expect(started).toEqual([]);
    expect(waitOf(q.id).wait_code).toBe("orch_paused");
  });

  it("places an orchestrator's task and tells it where it started", async () => {
    const t = setup(null);
    const q = queue(t, "orch work", { originWorkspaceId: t.workspace.id });
    finish(t.task);
    redHome();
    peers = { box: { level: "green" } };
    await tick();
    expect(startedOn.get("orch work")).toBe("box");
    const event = db
      .prepare(
        `SELECT line FROM orchestrator_events WHERE workspace_id = ? AND key LIKE ?`
      )
      .get(t.workspace.id, `%queued-start:${q.id}`) as { line: string };
    expect(event.line).toContain("started on box · this machine load red");
  });

  it("doesn't place an orchestrator's task on a machine that can't hold it", async () => {
    const t = setup(null);
    seedOrchestrator("orch-1");
    queue(t, "orch old", { startedBy: "orch-1" });
    queue(t, "person old");
    finish(t.task);
    redHome();
    peers = { old: { level: "green", noHold: true } };
    await tick();
    expect(startedOn.get("person old")).toBe("old");
    expect(startedOn.has("orch old")).toBe(false);
    expect(started.map((s) => s.prompt)).not.toContain("orch old");
  });

  it("starts at home when the home machine is free", async () => {
    const t = setup(null);
    queue(t, "home");
    finish(t.task);
    peers = { box: { level: "green" } };
    await tick();
    expect(startedOn.get("home")).toBeUndefined();
    expect(started.map((s) => s.prompt)).toEqual(["home"]);
  });
});

describe("the orchestrator's start now", () => {
  const orchQueue = (t: ReturnType<typeof setup>, prompt: string, extra = {}) =>
    queueIfNeeded({
      startedVia: "person",
      projectId: t.app.id,
      prompt,
      originWorkspaceId: t.workspace.id,
      ...extra,
    })!;

  it("starts past a full running-task limit", async () => {
    const t = setup(1);
    const q = orchQueue(t, "urgent fix");
    expect(q).toMatchObject({ status: "queued" });
    const out = await startQueuedForOrchestrator(t.workspace.id, q.id);
    expect(out).toMatchObject({
      outcome: "started",
      wasFull: true,
      running: 1,
      limit: 1,
    });
    expect(started.map((s) => s.prompt)).toEqual(["urgent fix"]);
    expect(statusOf(q.id)).toBe("started");
  });

  it("skips an after it was waiting on", async () => {
    const t = setup(null);
    const q = orchQueue(t, "early", { after: t.task });
    const out = await startQueuedForOrchestrator(t.workspace.id, q.id);
    expect(out).toMatchObject({ outcome: "started", skippedAfter: true });
  });

  it("is refused while paused, and stays queued", async () => {
    const t = setup(1);
    const q = orchQueue(t, "urgent fix");
    setPaused(t.workspace.id, true);
    const out = await startQueuedForOrchestrator(t.workspace.id, q.id);
    expect(out).toMatchObject({ outcome: "held" });
    expect(out.text).toMatch(/paused/);
    expect(started).toEqual([]);
    expect(statusOf(q.id)).toBe("queued");
  });

  it("keeps a task that needs a Mac off a machine that isn't one", async () => {
    const t = setup(1);
    const q = orchQueue(t, "ios", { machine: "mac" });
    capabilities = ["linux"];
    const out = await startQueuedForOrchestrator(t.workspace.id, q.id);
    expect(out).toMatchObject({ outcome: "held" });
    expect(out.text).toMatch(/Mac/);
    expect(started).toEqual([]);
    expect(statusOf(q.id)).toBe("queued");
  });

  it("refuses a task that isn't queued in that workspace", async () => {
    const t = setup(1);
    const other = seedWorkspace();
    const q = orchQueue(t, "mine");
    await expect(
      startQueuedForOrchestrator(other.workspace.id, q.id)
    ).rejects.toThrow(/isn't waiting/);
  });
});

describe("now on a direct start", () => {
  it("skips the full limit instead of queueing", () => {
    const t = setup(1);
    expect(
      queueIfNeeded({ startedVia: "person", projectId: t.app.id, prompt: "x" })
    ).toMatchObject({
      status: "queued",
    });
    expect(
      queueIfNeeded({
        startedVia: "person",
        projectId: t.app.id,
        prompt: "y",
        now: true,
      })
    ).toBeNull();
  });

  it("can't be combined with after", () => {
    const t = setup(null);
    expect(() =>
      queueIfNeeded({
        startedVia: "person",
        projectId: t.app.id,
        prompt: "y",
        now: true,
        after: t.task,
      })
    ).toThrow(/now and after/);
  });

  it("refuses a Mac-only task on a machine that isn't one", () => {
    const t = setup(1);
    capabilities = ["linux"];
    expect(() =>
      queueIfNeeded({
        startedVia: "person",
        projectId: t.app.id,
        prompt: "ios",
        machine: "mac",
        now: true,
      })
    ).toThrow(/needs a Mac/);
  });
});

describe("a plan-only task and the running-task limit", () => {
  it("doesn't count while its plan waits for approval", () => {
    const t = setup(1);
    updateSessionRow(db, t.task, { plan_only: 1, plan_phase: "awaiting" });
    expect(
      queueIfNeeded({
        startedVia: "person",
        projectId: t.app.id,
        prompt: "next",
      })
    ).toBeNull();
    updateSessionRow(db, t.task, { plan_phase: "implementing" });
    expect(
      queueIfNeeded({
        startedVia: "person",
        projectId: t.app.id,
        prompt: "next",
      })
    ).toMatchObject({ status: "queued" });
  });

  it("holds no slot while it starts", async () => {
    const t = setup(1);
    let release!: () => void;
    const slow = new Promise<void>((r) => (release = r));
    finish(t.task);
    const planning = startOrQueue(
      {
        startedVia: "person",
        projectId: t.app.id,
        prompt: "plan",
        planOnly: true,
      },
      () => slow.then(() => "p")
    );
    const other = await startOrQueue(
      { startedVia: "person", projectId: t.app.id, prompt: "b" },
      async () => "b"
    );
    expect(other).toEqual({ started: "b" });
    release();
    await planning;
  });
});
