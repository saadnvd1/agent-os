import { afterEach, describe, expect, it, vi } from "vitest";
import { buildId } from "../build";
import type { WorkerCommand, WorkerEvent } from "./worker/protocol";

// Each worker connected to answers with the next hello in `hellos` (the
// last one repeats); its commands and the server's handlers are kept.
type Handlers = {
  onEvent: (e: WorkerEvent) => void;
  onClose: (detached: boolean) => void;
};
const workers = vi.hoisted(() => ({
  running: [] as string[],
  hellos: [] as { build: string; state: string; caps?: string[] }[],
  connects: [] as { spawn: boolean; commands: WorkerCommand[] }[],
  handlers: [] as Handlers[],
}));
vi.mock("./worker/client", () => ({
  runningWorkers: () => workers.running,
  removeStaleSocket: () => {},
  waitForExit: async () => {},
  connectWorker: async (_id: string, spawn: boolean, handlers: Handlers) => {
    const hello =
      workers.hellos[workers.connects.length] ?? workers.hellos.at(-1)!;
    const conn = { spawn, commands: [] as WorkerCommand[] };
    workers.connects.push(conn);
    workers.handlers.push(handlers);
    return {
      client: {
        command: (c: WorkerCommand) => conn.commands.push(c),
        detach: () => {},
      },
      hello: { type: "hello", version: 1, streaming: [], ...hello },
    };
  },
}));

const { registry } = await import("./registry");
const { reattachChats } = await import("./runner");
const { enqueue, listQueue } = await import("./queued");
const { seedSession } = await import("../orchestrator/testing");
const { createProject } = await import("../projects");

const OLD = "old-build";
const ALL = ["plan", "queue", "retire"];

function chat(): string {
  const project = createProject({
    name: `p-${Math.random().toString(36).slice(2, 8)}`,
    workingDirectory: "/tmp/p",
  });
  const id = seedSession({ projectId: project.id, name: "chat", view: "chat" });
  workers.running = [id];
  return id;
}

const retires = (i = 0) =>
  workers.connects[i].commands.filter((c) => c.type === "retire").length;

afterEach(() => {
  for (const id of workers.running) registry.live.delete(id);
  workers.running = [];
  workers.hellos = [];
  workers.connects = [];
  workers.handlers = [];
});

describe("a worker from before a deploy", () => {
  it("is told once to retire at its next turn boundary when it's mid-turn", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const id = chat();
      workers.hellos = [{ build: OLD, state: "running", caps: ALL }];
      await reattachChats();
      expect(workers.connects).toHaveLength(1);
      expect(retires()).toBe(1);
      // Its turns ending don't make the server close it under it, queue or
      // not: it closes itself when nothing it holds is left to run.
      enqueue(id, { id: "user-q0", text: "waiting" });
      workers.handlers[0].onEvent({ type: "state", state: "idle" });
      workers.handlers[0].onEvent({ type: "state", state: "running" });
      workers.handlers[0].onEvent({ type: "state", state: "idle" });
      vi.advanceTimersByTime(10 * 60 * 1000);
      expect(workers.connects[0].commands.map((c) => c.type)).not.toContain(
        "close"
      );
      expect(retires()).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("isn't told to retire on the current build", async () => {
    chat();
    workers.hellos = [{ build: buildId(), state: "running", caps: ALL }];
    await reattachChats();
    expect(retires()).toBe(0);
  });

  it("from before retire existed, is left to the idle check", async () => {
    chat();
    workers.hellos = [
      { build: OLD, state: "running", caps: ["plan", "queue"] },
    ];
    await reattachChats();
    expect(retires()).toBe(0);
  });

  it("once it has retired itself, a current worker resumes, sends what waited and says it restarted", async () => {
    const id = chat();
    // Queued before the restart, so the reattach already tried to send it
    // within the last minute.
    enqueue(id, { id: "user-q1", text: "an event that came mid-turn" });
    workers.hellos = [
      { build: OLD, state: "running", caps: ALL },
      { build: buildId(), state: "idle", caps: ALL },
    ];
    await reattachChats();
    expect(retires()).toBe(1);
    workers.handlers[0].onClose(false);
    await vi.waitFor(() =>
      expect(workers.connects[1]?.commands).toContainEqual({ type: "drain" })
    );
    expect(workers.connects[1].spawn).toBe(true);
    const types = workers.connects[1].commands.map((c) => c.type);
    expect(types.indexOf("restarted")).toBeGreaterThan(-1);
    expect(types.indexOf("restarted")).toBeLessThan(types.indexOf("drain"));
    expect(retires(1)).toBe(0);
    expect(listQueue(id).map((m) => m.id)).toEqual(["user-q1"]);
    await new Promise((r) => setTimeout(r, 50));
    expect(workers.connects).toHaveLength(2);
  });
});
