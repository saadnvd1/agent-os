import { afterEach, describe, expect, it, vi } from "vitest";
import { buildId } from "../build";
import type { WorkerCommand } from "./worker/protocol";

// Workers that are "running" and answer with this hello; every command they
// get is kept.
const workers = vi.hoisted(() => ({
  // Called with each send, as the worker would take it.
  onSend: (_id: string, _cmd: unknown) => {},
  running: [] as string[],
  caps: undefined as string[] | undefined,
  state: "running" as string,
  commands: [] as WorkerCommand[],
}));
vi.mock("./worker/client", () => ({
  runningWorkers: () => workers.running,
  removeStaleSocket: () => {},
  waitForExit: async () => {},
  connectWorker: async () => ({
    client: {
      command: (c: WorkerCommand) => {
        workers.commands.push(c);
        if (c.type === "send") workers.onSend(workers.running[0], c);
      },
      detach: () => {},
    },
    hello: {
      type: "hello",
      version: 1,
      build: buildId(),
      state: workers.state,
      streaming: [],
      caps: workers.caps,
    },
  }),
}));

const { getDb } = await import("@/lib/db");
const { registry } = await import("./registry");
const { carryOutPlan, reattachChats } = await import("./runner");
const { listItems, saveItem } = await import("./store");
const { seedSession } = await import("../orchestrator/testing");
const { createProject } = await import("../projects");

async function reattach(caps: string[] | undefined) {
  const project = createProject({
    name: `p-${Math.random().toString(36).slice(2, 8)}`,
    workingDirectory: "/tmp/p",
  });
  const id = seedSession({ projectId: project.id, name: "chat", view: "chat" });
  getDb()
    .prepare(
      `UPDATE sessions SET chat_plan = 1, chat_access = 'ask' WHERE id = ?`
    )
    .run(id);
  workers.running = [id];
  workers.caps = caps;
  workers.commands = [];
  await reattachChats();
  registry.live.delete(id);
  return workers.commands;
}

describe("reattaching to a running worker", () => {
  it("hands it the access and plan mode saved while it was away", async () => {
    expect(await reattach(["plan"])).toEqual([
      { type: "set_access", access: "ask" },
      { type: "set_plan", plan: true },
    ]);
  });

  it("doesn't send plan mode to a worker that can't take it", async () => {
    expect(await reattach(undefined)).toEqual([
      { type: "set_access", access: "ask" },
    ]);
  });
});

describe("carrying out a plan right after a restart", () => {
  afterEach(() => {
    for (const id of workers.running) registry.live.delete(id);
    workers.state = "running";
    workers.onSend = () => {};
    workers.running = [];
  });

  it("goes ahead with an idle worker it attaches to", async () => {
    const project = createProject({
      name: `p-${Math.random().toString(36).slice(2, 8)}`,
      workingDirectory: "/tmp/p",
    });
    const id = seedSession({
      projectId: project.id,
      name: "chat",
      view: "chat",
    });
    getDb().prepare(`UPDATE sessions SET chat_plan = 1 WHERE id = ?`).run(id);
    saveItem(id, { id: "plan-t1", kind: "plan", plan: "# Plan", createdAt: 1 });
    registry.live.delete(id);
    workers.running = [id];
    workers.state = "idle";
    workers.caps = ["plan"];
    workers.commands = [];
    workers.onSend = (sid, cmd) => {
      const c = cmd as { id: string; text: string };
      saveItem(sid, { id: c.id, kind: "user", text: c.text, createdAt: 2 });
    };
    await carryOutPlan(id, "plan-t1", 50);
    const types = workers.commands.map((c) =>
      c.type === "set_plan" ? `set_plan:${c.plan}` : c.type
    );
    expect(types.indexOf("set_plan:false")).toBeGreaterThan(-1);
    expect(types.indexOf("set_plan:false")).toBeLessThan(types.indexOf("send"));
    expect(workers.commands.find((c) => c.type === "send")).toMatchObject({
      id: "user-carry-plan-t1",
      // The reader's decision, not a message they typed.
      origin: { kind: "decision" },
    });
    expect(listItems(id).find((i) => i.id === "plan-t1")).toMatchObject({
      carried: true,
    });
  });

  for (const state of ["running", "waiting"]) {
    it(`asks the worker, and waits while it's ${state}`, async () => {
      const project = createProject({
        name: `p-${Math.random().toString(36).slice(2, 8)}`,
        workingDirectory: "/tmp/p",
      });
      const id = seedSession({
        projectId: project.id,
        name: "chat",
        view: "chat",
      });
      getDb().prepare(`UPDATE sessions SET chat_plan = 1 WHERE id = ?`).run(id);
      saveItem(id, {
        id: "plan-t1",
        kind: "plan",
        plan: "# Plan",
        createdAt: 1,
      });
      // Nothing attached yet: the server has just restarted.
      registry.live.delete(id);
      workers.running = [id];
      workers.state = state;
      workers.caps = ["plan"];
      workers.commands = [];
      await expect(carryOutPlan(id, "plan-t1")).rejects.toThrow(
        "once this turn ends"
      );
      const chatPlan = (
        getDb()
          .prepare(`SELECT chat_plan FROM sessions WHERE id = ?`)
          .get(id) as {
          chat_plan: number;
        }
      ).chat_plan;
      expect(chatPlan).toBe(1);
      expect(workers.commands).not.toContainEqual({
        type: "set_plan",
        plan: false,
      });
      expect(workers.commands.some((c) => c.type === "send")).toBe(false);
      expect(listItems(id).find((i) => i.id === "plan-t1")).not.toHaveProperty(
        "carried"
      );
    });
  }
});
