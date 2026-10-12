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
const { reattachChats, freshStartChat } = await import("./runner");
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

  it("once it has retired itself, a current worker resumes, sends what waited", async () => {
    const id = chat();
    // No worker running at the restart: the reattach starts one to send the
    // queue, which arms the once-a-minute resume, and that one is old.
    workers.running = [];
    enqueue(id, { id: "user-q1", text: "an event that came mid-turn" });
    workers.hellos = [
      { build: OLD, state: "running", caps: ALL },
      { build: buildId(), state: "idle", caps: ALL },
    ];
    await reattachChats();
    expect(workers.connects).toHaveLength(1);
    expect(retires()).toBe(1);
    workers.handlers[0].onClose(false);
    await vi.waitFor(() =>
      expect(workers.connects[1]?.commands).toContainEqual({ type: "drain" })
    );
    expect(workers.connects[1].spawn).toBe(true);
    expect(retires(1)).toBe(0);
    expect(listQueue(id).map((m) => m.id)).toEqual(["user-q1"]);
    await new Promise((r) => setTimeout(r, 50));
    expect(workers.connects).toHaveLength(2);
  });
});

describe("a worker that ended its conversation at the context threshold", () => {
  it("has what queued sent by a new worker at once, inside the resume window", async () => {
    const { db } = await import("../db");
    const id = chat();
    workers.running = [];
    enqueue(id, { id: "user-q1", text: "an event before the fresh start" });
    workers.hellos = [{ build: buildId(), state: "running", caps: ALL }];
    // The reattach starts a worker to send the queue: the once-a-minute
    // resume is armed.
    await reattachChats();
    expect(workers.connects).toHaveLength(1);
    enqueue(id, { id: "user-q2", text: "an event while it went" });
    db.prepare(`UPDATE sessions SET chat_refreshed = 210000 WHERE id = ?`).run(
      id
    );
    workers.handlers[0].onClose(false);
    await vi.waitFor(() =>
      expect(workers.connects[1]?.commands).toContainEqual({ type: "drain" })
    );
    expect(workers.connects[1].spawn).toBe(true);
    await new Promise((r) => setTimeout(r, 50));
    expect(workers.connects).toHaveLength(2);
  });
});

describe("a fresh start the reader asked for", () => {
  const resumeId = async (id: string, value: string) =>
    (await import("../db")).db
      .prepare(`UPDATE sessions SET claude_session_id = ? WHERE id = ?`)
      .run(value, id);
  const saved = async (id: string) =>
    (await import("../db")).db
      .prepare(
        `SELECT claude_session_id, chat_refreshed FROM sessions WHERE id = ?`
      )
      .get(id);

  it("with no worker running, ends the conversation in the database at once", async () => {
    const id = chat();
    workers.running = [];
    await resumeId(id, "conv-old");
    expect(await freshStartChat(id)).toBe("now");
    expect(await saved(id)).toEqual({
      claude_session_id: null,
      chat_refreshed: -1,
    });
    expect(workers.connects).toHaveLength(0);
  });

  it("tells a running worker, which waits for the turn boundary", async () => {
    const id = chat();
    workers.hellos = [
      { build: buildId(), state: "running", caps: [...ALL, "fresh"] },
    ];
    await reattachChats();
    expect(await freshStartChat(id)).toBe("after-turn");
    expect(workers.connects[0].commands).toContainEqual({ type: "fresh" });
    // Nothing is touched here: the worker ends it when its turn does.
    expect((await saved(id)) as object).toMatchObject({ chat_refreshed: 0 });
  });

  it("answers now for an idle worker", async () => {
    const id = chat();
    workers.hellos = [
      { build: buildId(), state: "idle", caps: [...ALL, "fresh"] },
    ];
    await reattachChats();
    expect(await freshStartChat(id)).toBe("now");
  });

  it("won't guess for a busy worker from before it existed", async () => {
    const id = chat();
    workers.hellos = [{ build: buildId(), state: "running", caps: ALL }];
    await reattachChats();
    await expect(freshStartChat(id)).rejects.toThrow(/turn has ended/);
  });
});
