import { randomUUID } from "crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const status = new Map<string, "running" | "idle" | "waiting" | "dead">();
const sent: { sessionId: string; input: Record<string, unknown> }[] = [];

vi.mock("@/lib/chat/runner", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/chat/runner")>()),
  sendChat: async (sessionId: string, input: Record<string, unknown>) => {
    sent.push({ sessionId, input });
  },
  stopChat: () => {},
  chatState: () => null,
}));
vi.mock("@/lib/orchestrator/facts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/orchestrator/facts")>()),
  statusOf: async (s: { id: string }) => ({
    status: status.get(s.id) ?? "running",
    activity: null,
    needsInput: status.get(s.id) === "waiting",
  }),
}));
vi.mock("@/lib/sessions/launch", async () => {
  const { db, insertSessionRow } = await import("@/lib/db");
  return {
    launchSession: async (input: {
      id: string;
      projectId: string;
      name: string;
      parentSessionId: string;
      workingDirectory: string;
    }) => {
      insertSessionRow(db, {
        id: input.id,
        name: input.name,
        tmux_name: `claude-${input.id}`,
        working_directory: input.workingDirectory,
        project_id: input.projectId,
        view: "chat",
        parent_session_id: input.parentSessionId,
      });
      return { session: { id: input.id } };
    },
  };
});
vi.mock("@/lib/fork/worktree", () => ({
  createForkWorktree: async ({
    childId,
    parentCwd,
  }: {
    childId: string;
    parentCwd: string;
  }) => ({
    cwd: `${parentCwd}/.wt-${childId}`,
    root: `${parentCwd}/.wt-${childId}`,
    linked: false,
    head: "abc",
  }),
}));
vi.mock("@/lib/fork/conversation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/fork/conversation")>()),
  forkConversation: async () => ({ claudeSessionId: "forked-1", cut: "m9" }),
}));
vi.mock("@/lib/fork/scratch", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/fork/scratch")>()),
  ensureScratch: async (id: string) => `/tmp/scratch-${id}`,
  removeFork: async () => {},
}));

const { db } = await import("@/lib/db");
const { seedSession } = await import("@/lib/orchestrator/testing");
const { createProject } = await import("@/lib/projects");
const { createWorkspace, setProjectWorkspace } =
  await import("@/lib/workspaces");
const { setExperiment } = await import("@/lib/experiments");
const { saveItem } = await import("@/lib/chat/store");
const ledger = await import("./ledger");
const { startFork, admitQueued } = await import("./start");
const { returnChild, cancelChildren, lookAtChild } = await import("./settle");
const { deliverDue } = await import("./deliver");
const { heldForNext } = await import("./held");
const { registerForkWait, tickForkWaits } = await import("./waits");
const { forksTick } = await import("./tick");
const { statsOf } = await import("./view");
const { FORK_LIMITS } = await import("./options");

function parent(opts: { task?: boolean; limit?: number } = {}) {
  const ws = createWorkspace(`ws-${randomUUID().slice(0, 6)}`);
  const project = createProject({
    name: `p-${randomUUID().slice(0, 6)}`,
    workingDirectory: "/tmp/p",
  });
  setProjectWorkspace(project.id, ws.id);
  if (opts.limit)
    db.prepare(`UPDATE workspaces SET max_running_tasks = ? WHERE id = ?`).run(
      opts.limit,
      ws.id
    );
  const id = seedSession({
    projectId: project.id,
    name: "parent",
    view: "chat",
    task: opts.task,
  });
  db.prepare(
    `UPDATE sessions SET agent_type = 'claude', claude_session_id = 'parent-claude' WHERE id = ?`
  ).run(id);
  return id;
}

const started = (parentId: string) =>
  ledger
    .childrenOf(parentId)
    .filter((c) => c.state !== "queued" && c.state !== "settled");
const flush = () => new Promise((r) => setTimeout(r, 25));
const toParent = (id: string) => sent.filter((s) => s.sessionId === id);

beforeEach(() => {
  setExperiment("forks", true);
  status.clear();
  sent.length = 0;
});

describe("starting forks", () => {
  it("is off until the experiment is on", () => {
    setExperiment("forks", false);
    expect(() =>
      startFork({
        parentId: parent(),
        requestId: "r",
        instructions: ["a"],
        startedBy: "agent",
      })
    ).toThrow(/off/);
  });

  it("makes one row per instruction, once per request", async () => {
    const p = parent();
    const a = startFork({
      parentId: p,
      requestId: "same",
      instructions: ["one", "two"],
      startedBy: "agent",
    });
    const b = startFork({
      parentId: p,
      requestId: "same",
      instructions: ["one", "two"],
      startedBy: "agent",
    });
    expect(a.children.map((c) => c.n)).toEqual([1, 2]);
    expect(b.repeat).toBe(true);
    expect(b.groupId).toBe(a.groupId);
    expect(ledger.childrenOf(p)).toHaveLength(2);
    await flush();
  });

  it("refuses a child and too many", async () => {
    const p = parent();
    const many = Array.from(
      { length: FORK_LIMITS.maxPerFork + 1 },
      (_, i) => `t${i}`
    );
    expect(() =>
      startFork({
        parentId: p,
        requestId: "x",
        instructions: many,
        startedBy: "agent",
      })
    ).toThrow(/At most/);
    const r = startFork({
      parentId: p,
      requestId: "y",
      instructions: ["a"],
      startedBy: "agent",
    });
    await vi.waitFor(() =>
      expect(ledger.getChild(r.children[0].id)?.state).toBe("running")
    );
    expect(() =>
      startFork({
        parentId: r.children[0].id,
        requestId: "z",
        instructions: ["n"],
        startedBy: "agent",
      })
    ).toThrow(/can't fork/);
  });

  it("starts a child with its parent's conversation and tells it so", async () => {
    const p = parent();
    const r = startFork({
      parentId: p,
      requestId: "c",
      instructions: ["look at X"],
      startedBy: "agent",
    });
    await vi.waitFor(() => expect(toParent(r.children[0].id)).toHaveLength(1));
    const first = toParent(r.children[0].id)[0].input;
    expect(String(first.text)).toContain("look at X");
    expect(String(first.text)).not.toContain(
      "don't have the parent's conversation"
    );
    const row = db
      .prepare(`SELECT claude_session_id FROM sessions WHERE id = ?`)
      .get(r.children[0].id) as { claude_session_id: string };
    expect(row.claude_session_id).toBe("forked-1");
    expect(ledger.getChild(r.children[0].id)?.cut_message_id).toBe("m9");
  });
});

describe("a parent never waits behind its own children", () => {
  it("runs 3 children one after another at a limit of 1, and an --all wait delivers all", async () => {
    const p = parent({ task: true, limit: 1 });
    const r = startFork({
      parentId: p,
      requestId: "dl",
      instructions: ["a", "b", "c"],
      startedBy: "agent",
    });
    await vi.waitFor(() => expect(started(p)).toHaveLength(1));
    expect(
      ledger.childrenOf(p).filter((c) => c.state === "queued")
    ).toHaveLength(2);
    expect("already" in registerForkWait(p, "all")).toBe(false);

    for (let i = 0; i < 3; i++) {
      const open = started(p);
      expect(open).toHaveLength(1);
      await vi.waitFor(() =>
        expect(toParent(open[0].child_session_id)).toHaveLength(1)
      );
      await returnChild(open[0].child_session_id, `result ${i}\ndetail`, false);
      await admitQueued(p);
      if (i < 2) await vi.waitFor(() => expect(started(p)).toHaveLength(1));
    }
    await tickForkWaits();
    const wake = toParent(p);
    expect(wake).toHaveLength(1);
    expect(String(wake[0].input.text)).toMatch(/3 forks finished/);
    expect(String(wake[0].input.text)).toContain("result 2");
    expect(r.children).toHaveLength(3);
  });

  it("holds back later children past the per-parent cap, not the first", async () => {
    const p = parent();
    startFork({
      parentId: p,
      requestId: "cap",
      instructions: ["1", "2", "3", "4", "5", "6"],
      startedBy: "agent",
    });
    await vi.waitFor(() =>
      expect(started(p)).toHaveLength(FORK_LIMITS.maxRunningPerParent)
    );
    expect(
      ledger.childrenOf(p).filter((c) => c.state === "queued")
    ).toHaveLength(2);
  });
});

describe("how a child ends", () => {
  async function one() {
    const p = parent();
    const r = startFork({
      parentId: p,
      requestId: randomUUID(),
      instructions: ["job"],
      startedBy: "agent",
    });
    const id = r.children[0].id;
    await vi.waitFor(() => expect(ledger.getChild(id)?.state).toBe("running"));
    return { p, id };
  }

  it("settles once on aos return, a second return replaces the text", async () => {
    const { id } = await one();
    expect(await returnChild(id, "first\nmore", false)).toBe("settled");
    expect(await returnChild(id, "revised", false)).toBe("updated");
    const row = ledger.getChild(id)!;
    expect(row.state).toBe("settled");
    expect(row.result_kind).toBe("explicit");
    expect(row.summary).toBe("revised");
  });

  it("only one of two racing settles wins", async () => {
    const { id } = await one();
    const [a, b] = await Promise.all([
      returnChild(id, "x", false),
      returnChild(id, "y", true),
    ]);
    expect([a, b].sort()).toEqual(["settled", "updated"]);
  });

  it("settles with its last reply after the grace, marked implicit", async () => {
    const { id } = await one();
    saveItem(id, {
      id: "a1",
      kind: "assistant",
      text: "Found it: the cache key.\nDetails…",
      createdAt: Date.now(),
    });
    status.set(id, "idle");
    const t0 = Date.now();
    await lookAtChild(ledger.getChild(id)!, t0);
    await lookAtChild(
      ledger.getChild(id)!,
      t0 + FORK_LIMITS.implicitGraceMs - 1000
    );
    expect(ledger.getChild(id)!.state).toBe("running");
    await lookAtChild(
      ledger.getChild(id)!,
      t0 + FORK_LIMITS.implicitGraceMs + 1000
    );
    const row = ledger.getChild(id)!;
    expect(row.state).toBe("settled");
    expect(row.result_kind).toBe("implicit");
    expect(row.summary).toBe("Found it: the cache key.");
    expect(statsOf([row]).implicit).toBe(1);
  });

  it("does not settle a child that is waiting on its parent's answer, or needs input", async () => {
    const { id, p } = await one();
    saveItem(id, {
      id: "a1",
      kind: "assistant",
      text: "Which branch?",
      createdAt: Date.now(),
    });
    status.set(id, "idle");
    const { openWait } = await import("@/lib/bus/waits/store");
    openWait({
      waiterId: id,
      targetId: p,
      kind: "reply",
      deadline: Date.now() + 600_000,
    });
    const t0 = Date.now();
    await lookAtChild(ledger.getChild(id)!, t0);
    await lookAtChild(
      ledger.getChild(id)!,
      t0 + FORK_LIMITS.implicitGraceMs * 2
    );
    expect(ledger.getChild(id)!.state).toBe("running");
    status.set(id, "waiting");
    await lookAtChild(ledger.getChild(id)!, t0 + 1);
    expect(ledger.getChild(id)!.state).toBe("needs_input");
  });

  it("cancelling settles without telling the parent", async () => {
    const { p, id } = await one();
    await cancelChildren(p);
    const row = ledger.getChild(id)!;
    expect(row.outcome).toBe("cancelled");
    expect(ledger.undelivered(p)).toHaveLength(0);
  });
});

describe("delivery", () => {
  it("batches results into one message after the quiet window", async () => {
    const p = parent();
    const r = startFork({
      parentId: p,
      requestId: "b",
      instructions: ["a", "b"],
      startedBy: "agent",
    });
    await vi.waitFor(() => expect(started(p)).toHaveLength(2));
    const t0 = Date.now();
    await returnChild(r.children[0].id, "alpha", false);
    await deliverDue(t0 + 1000);
    expect(toParent(p)).toHaveLength(0);
    await returnChild(r.children[1].id, "beta", false);
    await deliverDue(Date.now() + FORK_LIMITS.batchWindowMs + 1000);
    const got = toParent(p);
    expect(got).toHaveLength(1);
    expect(String(got[0].input.text)).toContain("alpha");
    expect(String(got[0].input.text)).toContain("beta");
    expect(got[0].input.queue).toBe(true);
    await deliverDue(Date.now() + 10 * FORK_LIMITS.batchWindowMs);
    expect(toParent(p)).toHaveLength(1);
  });

  it("sends a claimed delivery again under the same id after a crash", async () => {
    const p = parent();
    const r = startFork({
      parentId: p,
      requestId: "k",
      instructions: ["a"],
      startedBy: "agent",
    });
    await vi.waitFor(() => expect(started(p)).toHaveLength(1));
    await returnChild(r.children[0].id, "done", false);
    ledger.claimDelivery([r.children[0].id], "fork-d-crash");
    await deliverDue();
    expect(toParent(p)[0].input.id).toBe("fork-d-crash");
    expect(ledger.undelivered(p)).toHaveLength(0);
  });

  it("holds the user's own forks for their next message", async () => {
    const p = parent();
    const r = startFork({
      parentId: p,
      requestId: "u",
      instructions: ["a"],
      startedBy: "user",
    });
    await vi.waitFor(() => expect(started(p)).toHaveLength(1));
    await returnChild(r.children[0].id, "user-side result", false);
    await deliverDue(Date.now() + 10 * FORK_LIMITS.batchCapMs);
    expect(toParent(p)).toHaveLength(0);
    expect(heldForNext(p)).toContain("user-side result");
    expect(heldForNext(p)).toBe("");
  });

  it("a wait with --any wakes on the first result and not twice", async () => {
    const p = parent();
    const r = startFork({
      parentId: p,
      requestId: "w",
      instructions: ["a", "b"],
      startedBy: "agent",
    });
    await vi.waitFor(() => expect(started(p)).toHaveLength(2));
    registerForkWait(p, "any");
    await tickForkWaits();
    expect(toParent(p)).toHaveLength(0);
    await returnChild(r.children[1].id, "b-done", false);
    await tickForkWaits();
    await forksTick(Date.now() + FORK_LIMITS.batchCapMs * 2);
    const got = toParent(p);
    expect(got).toHaveLength(1);
    expect(String(got[0].input.text)).toContain("b-done");
  });
});
