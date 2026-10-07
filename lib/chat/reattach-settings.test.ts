import { describe, expect, it, vi } from "vitest";
import { buildId } from "../build";
import type { WorkerCommand } from "./worker/protocol";

// Workers that are "running" and answer with this hello; every command they
// get is kept.
const workers = vi.hoisted(() => ({
  running: [] as string[],
  caps: undefined as string[] | undefined,
  commands: [] as WorkerCommand[],
}));
vi.mock("./worker/client", () => ({
  runningWorkers: () => workers.running,
  removeStaleSocket: () => {},
  waitForExit: async () => {},
  connectWorker: async () => ({
    client: {
      command: (c: WorkerCommand) => workers.commands.push(c),
      detach: () => {},
    },
    hello: {
      type: "hello",
      version: 1,
      build: buildId(),
      state: "running",
      streaming: [],
      caps: workers.caps,
    },
  }),
}));

const { getDb } = await import("@/lib/db");
const { registry } = await import("./registry");
const { reattachChats } = await import("./runner");
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
