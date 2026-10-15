import { randomUUID } from "crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "../db";
import type { TaskPR } from "./state";

const prs = new Map<string, TaskPR | null>();
const turns = new Map<string, "running" | "idle" | "unreachable">();
const screens = new Map<string, { status: string; pane: string }>();
const remoteStarts: { hostId: string; opts: Record<string, unknown> }[] = [];
const worktrees: Record<string, unknown>[] = [];

vi.mock("../worktrees", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../worktrees")>()),
  createWorktree: async (o: Record<string, unknown>) => {
    worktrees.push(o);
    return {
      worktreePath: `/tmp/wt-${o.featureName}`,
      branchName: `feature/${o.featureName}`,
    };
  },
}));
vi.mock("../git", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../git")>()),
  getDefaultBranch: async () => "main",
}));
vi.mock("../session-titles", () => ({
  nameFor: async (prompt: string, _dir: string, given?: string) => ({
    name: given || prompt.slice(0, 20),
    source: given ? "user" : "generated",
  }),
}));
vi.mock("./start", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./start")>()),
  finishTaskStart: async () => ({ status: "ok", ms: 0, error: null }),
}));
vi.mock("../lumifyhub/task-cards", () => ({
  attachTaskCard: async () => {},
  inBackground: () => {},
  syncTaskCardInBackground: () => {},
  taskCardUrl: () => null,
}));
vi.mock("./session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./session")>()),
  prFor: async (s: Session) => prs.get(s.id) ?? null,
}));
vi.mock("../chat/runner", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../chat/runner")>()),
  chatStateNow: async (id: string) => {
    const t = turns.get(id) ?? "idle";
    if (t === "unreachable") throw new Error("no worker");
    return t;
  },
}));
vi.mock("../chat/store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../chat/store")>()),
  saidSinceLastMessage: (id: string) =>
    screens.get(id)?.pane ?? "all done, nothing to ask",
}));
vi.mock("../status-detector", () => ({
  statusDetector: {
    getStatus: async (name: string) => screens.get(name)?.status ?? "dead",
    capturePane: async (name: string) => screens.get(name)?.pane ?? "",
    hostFor: () => "local",
    getTimestamp: () => 0,
    foregroundFor: () => undefined,
    paneProcess: () => undefined,
  },
}));
vi.mock("./contract/start", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./contract/start")>()),
  startRemoteTask: async (
    hostId: string,
    _p: unknown,
    opts: Record<string, unknown>
  ) => {
    remoteStarts.push({ hostId, opts });
    const { db, insertSessionRow } = await import("../db");
    insertSessionRow(db, {
      id: opts.id as string,
      name: "remote",
      tmux_name: `claude-${opts.id}`,
      working_directory: "/tmp",
      host_id: hostId,
      task_status: "running",
    });
    return db.prepare(`SELECT * FROM session_rows WHERE id = ?`).get(opts.id);
  },
}));
vi.mock("./contract/views", () => ({
  mirrorViews: async (rows: Session[]) =>
    rows.map((s) => ({
      id: s.id,
      name: s.name,
      createdAt: "2099-01-01 00:00:00",
      hostId: s.host_id,
      state: "working",
    })),
}));

const { db, insertSessionRow } = await import("../db");
const { createProject } = await import("../projects");
const { createTask, taskView, listTasks, taskRouting, ownedByATask } =
  await import("./index");

const row = (id: string) =>
  db.prepare(`SELECT * FROM session_rows WHERE id = ?`).get(id) as Session;

let projectId: string;
beforeEach(() => {
  prs.clear();
  turns.clear();
  screens.clear();
  remoteStarts.length = 0;
  worktrees.length = 0;
  projectId = createProject({
    name: `idx-${randomUUID().slice(0, 6)}`,
    workingDirectory: "/tmp",
  }).id;
});

const make = (o: Partial<Parameters<typeof createTask>[0]> = {}) =>
  createTask({ startedVia: "person", projectId, prompt: "fix it", ...o });

describe("createTask validation", () => {
  it("refuses an empty prompt, no project and the uncategorized one", async () => {
    await expect(make({ prompt: "  \n " })).rejects.toThrow(
      "Describe the task"
    );
    await expect(make({ projectId: randomUUID() })).rejects.toThrow(
      "Pick a project"
    );
    const unc = db
      .prepare(`SELECT id FROM projects WHERE is_uncategorized = 1`)
      .get() as { id: string } | undefined;
    if (unc)
      await expect(make({ projectId: unc.id })).rejects.toThrow(
        "Pick a project"
      );
    expect(worktrees).toHaveLength(0);
  });

  it("refuses a bad base branch and plan flags that contradict", async () => {
    await expect(make({ baseBranch: "bad branch;" })).rejects.toThrow(
      /isn't a branch name/
    );
    await expect(make({ planOnly: true, plan: false })).rejects.toThrow(
      /planOnly implies plan/
    );
    await expect(make({ planOnly: true, view: "terminal" })).rejects.toThrow(
      /needs a chat/
    );
    expect(worktrees).toHaveLength(0);
  });
});

describe("the rows createTask writes", () => {
  it("a task row carries its prompt, branch, base, brief and running status", async () => {
    const t = await make({ prompt: "  add a thing  ", name: "add thing" });
    const r = row(t.id);
    expect(r).toMatchObject({
      name: "add thing",
      name_source: "user",
      project_id: projectId,
      task_prompt: "add a thing",
      task_status: "running",
      setup_status: "running",
      view: "chat",
      base_branch: "main",
      agent_type: "claude",
      host_id: "local",
      started_via: "person",
    });
    expect(r.tmux_name).toBe(`claude-${t.id}`);
    expect(r.branch_name).toMatch(/^feature\/add-thing-/);
    expect(r.branch_name).toBe(`feature/add-thing-${t.id.slice(0, 4)}`);
    expect(r.worktree_path).toBe(`/tmp/wt-add-thing-${t.id.slice(0, 4)}`);
    expect(r.task_brief).toContain(r.branch_name!);
  });

  it("records the plan decision and the reason", async () => {
    const off = row((await make({ plan: false, planReason: " tiny " })).id);
    expect(off).toMatchObject({
      plan_decided: 0,
      plan_reason: "tiny",
      plan_phase: null,
    });
    const unstated = row((await make()).id);
    expect(unstated.plan_decided).toBeNull();
    expect(unstated.plan_reason).toBeNull();
    const only = row((await make({ planOnly: true })).id);
    expect(only).toMatchObject({
      plan_decided: 1,
      plan_only: 1,
      plan_phase: "planning",
    });
  });

  it("cuts a stacked task from its parent's tip", async () => {
    const t = await make({
      base: { branch: "feature/parent", tip: "abc123", stack: {} as never },
    });
    expect(row(t.id).base_branch).toBe("feature/parent");
    expect(worktrees[0]).toMatchObject({
      baseBranch: "feature/parent",
      startPoint: "abc123",
    });
  });

  it("calls onCreated with the id once the row exists", async () => {
    let seen: Session | undefined;
    const t = await make({ onCreated: (id) => (seen = row(id)) });
    expect(seen?.id).toBe(t.id);
  });

  it("a retry with the same id returns the same task and writes nothing new", async () => {
    const id = randomUUID();
    const a = await make({ id });
    const b = await make({ id });
    expect(b.id).toBe(a.id);
    expect(worktrees).toHaveLength(1);
    expect(a.id).toBe(id);
  });

  it("refuses an id that names a session that isn't a task", async () => {
    const id = randomUUID();
    db.prepare(
      `INSERT INTO sessions (id, name, tmux_name, working_directory) VALUES (?, 'x', ?, '/tmp')`
    ).run(id, `claude-${id}`);
    await expect(make({ id })).rejects.toThrow("That id is taken");
  });

  it("ownedByATask sees a task's worktree and its branch", async () => {
    const t = await make();
    const r = row(t.id);
    const feature = r.branch_name!.replace("feature/", "");
    expect(ownedByATask(projectId, "/tmp", feature)).toBe(true);
    expect(ownedByATask(projectId, "/tmp", "nothing-here-0000")).toBe(false);
  });
});

describe("tasks on a linked machine", () => {
  const host = "remote-host";
  it("hands a plain task to that machine and records who started it", async () => {
    const t = await make({ hostId: host, name: "far", baseBranch: "dev" });
    expect(remoteStarts).toHaveLength(1);
    expect(remoteStarts[0].hostId).toBe(host);
    expect(remoteStarts[0].opts).toMatchObject({
      prompt: "fix it",
      name: "far",
      baseBranch: "dev",
      view: "chat",
    });
    expect(row(t.id).started_via).toBe("person");
    expect(worktrees).toHaveLength(0);
  });

  it("hands a plan-only task over to plan there", async () => {
    await make({ hostId: host, planOnly: true });
    expect(remoteStarts).toHaveLength(1);
    expect(remoteStarts[0].opts).toMatchObject({
      plan: { only: true, reason: null },
    });
  });

  it("refuses plan-only with no plan, stacked and card tasks before calling it", async () => {
    await expect(
      make({ hostId: host, planOnly: true, plan: false })
    ).rejects.toThrow(/planOnly implies plan/);
    await expect(
      make({
        hostId: host,
        base: { branch: "b", tip: "t", stack: {} as never },
      })
    ).rejects.toThrow(/Stacked and card tasks/);
    await expect(make({ hostId: host, cardId: "c1" })).rejects.toThrow(
      /Stacked and card tasks/
    );
    expect(remoteStarts).toHaveLength(0);
  });
});

describe("taskView by phase", () => {
  function seed(extra: Record<string, unknown> = {}) {
    const id = randomUUID();
    const cols = {
      id,
      name: "t",
      tmux_name: `claude-${id}`,
      working_directory: "/tmp",
      project_id: projectId,
      task_status: "running",
      view: "terminal",
      branch_name: "feature/x",
      base_branch: "main",
      task_prompt: "the prompt",
      ...extra,
    };
    insertSessionRow(db, cols as Parameters<typeof insertSessionRow>[1]);
    return row(id);
  }
  const pr = (o: Partial<TaskPR> = {}): TaskPR => ({
    number: 5,
    url: "https://example.test/pull/5",
    state: "OPEN",
    checks: "pass",
    ...o,
  });

  it("planning: working, flagged as planning and not plan-ready", async () => {
    const s = seed({ view: "chat", plan_phase: "planning" });
    turns.set(s.id, "running");
    const v = await taskView(s);
    expect(v).toMatchObject({
      state: "working",
      planning: true,
      planReady: false,
      chatTurn: "running",
    });
    expect(v.prompt).toBe("the prompt");
  });

  it("awaiting: plan-ready, and its question isn't a block", async () => {
    const s = seed({ view: "chat", plan_phase: "awaiting" });
    screens.set(s.id, { status: "waiting", pane: "BLOCKED: need a key" });
    const v = await taskView(s);
    expect(v).toMatchObject({
      state: "plan-ready",
      planReady: true,
      blocked: null,
    });
  });

  it("implementing: working while the terminal runs, needs-input when it waits", async () => {
    const s = seed();
    screens.set(s.tmux_name, { status: "running", pane: "" });
    expect((await taskView(s)).state).toBe("working");
    screens.set(s.tmux_name, { status: "waiting", pane: "ready?" });
    expect((await taskView(s)).state).toBe("needs-input");
    screens.set(s.tmux_name, {
      status: "waiting",
      pane: "x\nBLOCKED: need a key",
    });
    const v = await taskView(s);
    expect(v.state).toBe("blocked");
    expect(v.blocked).toBe("need a key");
  });

  it("a chat whose worker can't be reached counts as busy", async () => {
    const s = seed({ view: "chat" });
    turns.set(s.id, "unreachable");
    expect((await taskView(s)).state).toBe("working");
  });

  it("PR open: review, or checks-failing", async () => {
    const s = seed();
    screens.set(s.tmux_name, { status: "waiting", pane: "" });
    prs.set(s.id, pr());
    const v = await taskView(s);
    expect(v.state).toBe("review");
    expect(v.pr?.number).toBe(5);
    prs.set(s.id, pr({ checks: "fail" }));
    expect((await taskView(s)).state).toBe("checks-failing");
  });

  it("merged: from the stored PR, never asking gh", async () => {
    const s = seed({
      task_status: "merged",
      pr_number: 8,
      pr_url: "https://example.test/pull/8",
      pr_status: "merged",
    });
    prs.set(s.id, pr({ number: 99 }));
    const v = await taskView(s);
    expect(v.state).toBe("merged");
    expect(v.pr).toMatchObject({ number: 8, state: "MERGED" });
  });

  it("dropped: its closed PR is kept, and it reads dropped", async () => {
    const s = seed({
      task_status: "dropped",
      pr_number: 9,
      pr_url: "u",
      pr_status: "closed",
    });
    const v = await taskView(s);
    expect(v.state).toBe("dropped");
    expect(v.pr).toMatchObject({ number: 9, state: "CLOSED" });
  });

  it("exited when nothing is running, and working while setup runs", async () => {
    const s = seed();
    expect((await taskView(s)).state).toBe("exited");
    const setting = seed({ setup_status: "running" });
    expect((await taskView(setting)).state).toBe("working");
  });

  it("carries the row's own fields: armed, held-from, quick-of", async () => {
    const s = seed({
      merge_armed_at: "2026-10-07 10:00:00",
      held_by_device: "dev-1",
      held_from: "other box",
      plan_note: "plan written",
    });
    const v = await taskView(s);
    expect(v).toMatchObject({
      armed: true,
      heldFrom: "other box",
      planNote: "plan written",
      hostId: null,
      branch: "feature/x",
      baseBranch: "main",
      projectId,
    });
    expect(v.lastActiveAt).toBeTypeOf("number");
    const plain = await taskView(seed());
    expect(plain).toMatchObject({
      armed: false,
      heldFrom: null,
      planNote: null,
    });
    expect(plain.lastActiveAt).toBeUndefined();
  });
});

describe("listTasks local and mirror split", () => {
  it("lists a local task through taskView and a mirror through the remote views, newest first", async () => {
    const local = await make({ name: "local one" });
    const mirror = await make({ hostId: "remote-host", name: "far" });
    const list = await listTasks();
    const l = list.find((t) => t.id === local.id);
    const m = list.find((t) => t.id === mirror.id);
    expect(l?.hostId).toBeNull();
    expect(l?.projectId).toBe(projectId);
    expect(m?.hostId).toBe("remote-host");
    expect(list.indexOf(m!)).toBeLessThan(list.indexOf(l!));
  });

  it("leaves mirrors without a local cost", async () => {
    const local = await make();
    const list = await listTasks();
    expect(list.find((t) => t.id === local.id)).toBeDefined();
    expect(
      list.filter((t) => t.hostId).every((t) => t.weighted === undefined)
    ).toBe(true);
  });
});

describe("taskRouting", () => {
  it("only a chat plans first, and plan-only plans even on one model", () => {
    const terminal = taskRouting(null, "terminal", undefined, true, true);
    expect(terminal.plan).toBe(false);
    expect(terminal.planOnly).toBe(false);
    const only = taskRouting(null, "chat", undefined, undefined, true);
    expect(only).toMatchObject({ plan: true, planOnly: true });
    const off = taskRouting(null, "chat", undefined, false);
    expect(off).toMatchObject({ plan: false, planOnly: false });
  });
});
