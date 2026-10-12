import { afterEach, describe, expect, it, vi } from "vitest";
import { buildId } from "../build";
import type { ChatServerMessage } from "./events";
import type { WorkerCommand, WorkerEvent } from "./worker/protocol";

type Handlers = {
  onEvent: (e: WorkerEvent) => void;
  onClose: (detached: boolean) => void;
};
const workers = vi.hoisted(() => ({
  running: [] as string[],
  hello: {} as Record<string, unknown>,
  handlers: [] as Handlers[],
}));
vi.mock("./worker/client", () => ({
  runningWorkers: () => workers.running,
  removeStaleSocket: () => {},
  waitForExit: async () => {},
  connectWorker: async (_id: string, _spawn: boolean, handlers: Handlers) => {
    workers.handlers.push(handlers);
    return {
      client: { command: (_c: WorkerCommand) => {}, detach: () => {} },
      hello: {
        type: "hello",
        version: 1,
        streaming: [],
        build: buildId(),
        state: "running",
        ...workers.hello,
      },
    };
  },
}));

const { registry } = await import("./registry");
const { reattachChats, chatCompacting, watchChat, stopChat } =
  await import("./runner");
const { collectStatuses } = await import("../status/collect");
const { seedSession } = await import("../orchestrator/testing");
const { createProject } = await import("../projects");

function chat(): string {
  const project = createProject({
    name: `p-${Math.random().toString(36).slice(2, 8)}`,
    workingDirectory: "/tmp/p",
  });
  const id = seedSession({ projectId: project.id, name: "chat", view: "chat" });
  workers.running = [id];
  return id;
}

afterEach(() => {
  for (const id of workers.running) registry.live.delete(id);
  workers.running = [];
  workers.hello = {};
  workers.handlers = [];
});

const since = 1_000;

describe("the server's view of a compaction", () => {
  it("follows the worker: on when it says so, off when the turn ends", async () => {
    const id = chat();
    await reattachChats();
    expect(chatCompacting(id)).toBeNull();
    workers.handlers[0].onEvent({
      type: "compacting",
      compacting: { since, before: 150_000 },
    });
    expect(chatCompacting(id)).toEqual({ since, before: 150_000 });
    workers.handlers[0].onEvent({ type: "state", state: "idle" });
    expect(chatCompacting(id)).toBeNull();
  });

  it("is cleared by an error state and by the worker going away", async () => {
    const id = chat();
    await reattachChats();
    workers.handlers[0].onEvent({
      type: "compacting",
      compacting: { since },
    });
    workers.handlers[0].onEvent({ type: "state", state: "error" });
    expect(chatCompacting(id)).toBeNull();
    workers.handlers[0].onEvent({
      type: "compacting",
      compacting: { since },
    });
    workers.handlers[0].onClose(true);
    expect(chatCompacting(id)).toBeNull();
  });

  it("tells a watcher when the chat is stopped mid-compaction", async () => {
    const id = chat();
    await reattachChats();
    workers.handlers[0].onEvent({ type: "compacting", compacting: { since } });
    const seen: ChatServerMessage[] = [];
    const unwatch = watchChat(id, (m) => seen.push(m));
    expect(seen[0]).toMatchObject({ type: "snapshot", compacting: { since } });
    stopChat(id);
    expect(seen).toContainEqual({ type: "compacting", compacting: null });
    unwatch();
  });

  it("is picked up again from a worker that was compacting before a restart", async () => {
    workers.hello = { compacting: { since, before: 90_000 } };
    const id = chat();
    await reattachChats();
    expect(chatCompacting(id)).toEqual({ since, before: 90_000 });
  });

  it("shows in the status payload while the state stays running", async () => {
    const id = chat();
    await reattachChats();
    workers.handlers[0].onEvent({ type: "compacting", compacting: { since } });
    const row = (await collectStatuses()).statuses[id];
    expect(row).toMatchObject({ status: "running", compacting: { since } });
    workers.handlers[0].onEvent({ type: "state", state: "idle" });
    expect((await collectStatuses()).statuses[id].compacting).toBeUndefined();
  });
});
