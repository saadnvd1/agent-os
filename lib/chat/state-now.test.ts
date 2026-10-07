import { randomUUID } from "crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Workers "running" (a socket on disk) and what connecting to one returns.
const workers = new Set<string>();
const spawns: boolean[] = [];
let reachable = true;

vi.mock("./worker/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./worker/client")>()),
  runningWorkers: () => [...workers],
  connectWorker: async (_id: string, spawn: boolean) => {
    spawns.push(spawn);
    if (!reachable)
      throw new Error("The chat worker didn't start: ECONNREFUSED");
    const { buildId } = await import("../build");
    return {
      client: { command: () => {}, detach: () => {} },
      hello: { state: "running", streaming: [], build: buildId(), caps: [] },
    };
  },
}));

const { chatStateNow } = await import("./runner");
const { registry } = await import("./registry");
const { seedSession } = await import("../orchestrator/testing");
const { createProject } = await import("../projects");

function chat(): string {
  const project = createProject({
    name: `p-${randomUUID().slice(0, 6)}`,
    workingDirectory: "/tmp/p",
  });
  return seedSession({ projectId: project.id, name: "chat", view: "chat" });
}

describe("chatStateNow", () => {
  beforeEach(() => {
    workers.clear();
    spawns.length = 0;
    reachable = true;
  });

  it("is null with no worker running, and starts none", async () => {
    expect(await chatStateNow(chat())).toBeNull();
    expect(spawns).toEqual([]);
  });

  it("asks a worker still running from before a restart, never spawning", async () => {
    const id = chat();
    workers.add(id);
    expect(registry.live.has(id)).toBe(false);
    expect(await chatStateNow(id)).toBe("running");
    expect(spawns).toEqual([false]);
  });

  it("throws when a running worker can't be reached", async () => {
    const id = chat();
    workers.add(id);
    reachable = false;
    await expect(chatStateNow(id)).rejects.toThrow(/ECONNREFUSED/);
  });
});
