import { execFileSync } from "child_process";
import { randomUUID } from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { describe, expect, it, vi } from "vitest";
import type { FileSuggestion } from "./events";
import type { WorkerHandlers } from "./worker/client";
import type { WorkerCommand } from "./worker/protocol";

// Workers are faked: which ones are "running", and each one a connect
// starts, with the handlers the server gave it.
const workers = vi.hoisted(() => ({
  running: [] as string[],
  // The build workers report; undefined for this server's own.
  build: undefined as string | undefined,
  state: "idle" as "idle" | "running",
  started: [] as {
    sessionId: string;
    handlers: WorkerHandlers;
    commands: unknown[];
  }[],
}));
vi.mock("./worker/client", async (original) => ({
  ...(await original<typeof import("./worker/client")>()),
  runningWorkers: () => workers.running,
  connectWorker: async (
    sessionId: string,
    _spawn: boolean,
    handlers: WorkerHandlers
  ) => {
    const { buildId } = await import("../build");
    const started = { sessionId, handlers, commands: [] as unknown[] };
    workers.started.push(started);
    return {
      client: {
        command: (cmd: unknown) => started.commands.push(cmd),
        detach: () => {},
      },
      hello: {
        type: "hello",
        version: 1,
        build: workers.build ?? buildId(),
        state: workers.state,
        streaming: [],
        caps: ["plan", "queue"],
      },
    };
  },
}));

const { registry } = await import("./registry");
const { db } = await import("../db");
const { claimNext, enqueue, listQueue } = await import("./queued");
const { chatFileSuggestions, editQueuedChat, reattachChats, sendChat } =
  await import("./runner");
const { seedSession } = await import("../orchestrator/testing");
const { listFiles, LISTERS } = await import("./files");
const { createProject } = await import("../projects");

// A git folder with a tracked file, an untracked one and an ignored one.
function repo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aos-files-"));
  execFileSync("git", ["init", "-q"], { cwd: dir });
  fs.mkdirSync(path.join(dir, "lib"));
  fs.writeFileSync(path.join(dir, "lib", "queue.ts"), "");
  fs.writeFileSync(path.join(dir, "notes.md"), "");
  fs.writeFileSync(path.join(dir, "secret.log"), "");
  fs.writeFileSync(path.join(dir, ".gitignore"), "*.log\n");
  execFileSync("git", ["add", "lib", ".gitignore"], { cwd: dir });
  return dir;
}

function session(cwd = "/tmp"): string {
  const project = createProject({
    name: `p-${randomUUID().slice(0, 6)}`,
    workingDirectory: cwd,
  });
  const id = seedSession({ projectId: project.id, name: "chat", view: "chat" });
  db.prepare(`UPDATE sessions SET working_directory = ? WHERE id = ?`).run(
    cwd,
    id
  );
  return id;
}

// A connected worker: its @mention answer, and the commands it gets.
function live(id: string, files: FileSuggestion[] | null = null) {
  const commands: WorkerCommand[] = [];
  registry.live.set(id, {
    worker: {
      command: (cmd: WorkerCommand) => commands.push(cmd),
      fileSuggestions: async () => files,
    } as never,
    state: "idle",
    streaming: new Map(),
    activity: { tools: new Map(), tasks: new Set() },
    canPlan: false,
    canQueue: true,
  });
  return commands;
}

// What a fresh worker is told beyond its settings (re-sent first on every
// connect, so a drained message runs in the session's current mode).
const queueCommands = (commands: unknown[]) =>
  commands.filter(
    (c) => !["set_access", "set_plan"].includes((c as { type: string }).type)
  );

const paths = (files: FileSuggestion[]) => files.map((f) => f.path);

describe("chatFileSuggestions", () => {
  it("uses the agent's own matches when it has some", async () => {
    const id = session();
    live(id, [{ path: "from/agent.ts", dir: false }]);
    expect(paths(await chatFileSuggestions(id, "agent"))).toEqual([
      "from/agent.ts",
    ]);
    registry.live.delete(id);
  });

  it("lists the folder itself while the agent's index is still empty", async () => {
    const id = session(repo());
    live(id, []);
    expect(paths(await chatFileSuggestions(id, "queue"))).toEqual([
      "lib/queue.ts",
    ]);
    registry.live.delete(id);
  });

  it("lists the folder with no worker, leaving ignored files out", async () => {
    const id = session(repo());
    const all = paths(await chatFileSuggestions(id, ""));
    expect(all).toEqual(
      expect.arrayContaining(["lib", "lib/queue.ts", "notes.md"])
    );
    expect(all).not.toContain("secret.log");
  });
});

describe("queue edits from the server", () => {
  it("keeps who sent a message that waits for setup", async () => {
    const id = session();
    db.prepare(`UPDATE sessions SET setup_status = 'running' WHERE id = ?`).run(
      id
    );
    const origin = { kind: "system", label: "AgentOS stacks" } as const;
    await sendChat(id, { text: "restacked", origin });
    expect(claimNext(id)).toMatchObject({ text: "restacked", origin });
  });

  it("hands a live worker who sent it", async () => {
    const id = session();
    const commands = live(id);
    const origin = { kind: "event", label: "AgentOS" } as const;
    await sendChat(id, { text: "CI green", from: "agentos", origin });
    expect(commands).toEqual([
      expect.objectContaining({ type: "send", text: "CI green", origin }),
    ]);
  });

  it("drops a message edited down to nothing, rather than queue a blank", () => {
    const id = session();
    enqueue(id, { id: "user-1", text: "keep" });
    enqueue(id, { id: "user-2", text: "drop" });
    editQueuedChat(id, "user-2", "   ");
    editQueuedChat(id, "user-1", " kept ");
    expect(listQueue(id).map((m) => m.text)).toEqual(["kept"]);
  });
});

describe("reattachChats", () => {
  it("sends the queue of a conversation whose worker is gone", async () => {
    // Only this conversation is queued: any other would start a real worker.
    db.prepare(`DELETE FROM chat_queue`).run();
    const id = session();
    enqueue(id, { id: "user-1", text: "first" });
    enqueue(id, { id: "user-2", text: "second" });
    // The worker a send starts, stood in for by a connected fake.
    const commands = live(id);
    await reattachChats();
    await new Promise((r) => setTimeout(r, 0));
    expect(commands).toContainEqual({ type: "drain" });
    // Draining never stops a turn, the way send now does.
    expect(commands.some((c) => c.type === "send_now")).toBe(false);
    registry.live.delete(id);
  });

  it("leaves a worker that's still running to send its own queue", async () => {
    db.prepare(`DELETE FROM chat_queue`).run();
    const id = session();
    enqueue(id, { id: "user-1", text: "first" });
    workers.running = [id];
    const commands = live(id);
    try {
      await reattachChats();
      await new Promise((r) => setTimeout(r, 0));
      expect(commands).toEqual([]);
    } finally {
      workers.running = [];
      registry.live.delete(id);
    }
  });

  it("doesn't send a backlog from long ago unasked", async () => {
    db.prepare(`DELETE FROM chat_queue`).run();
    const id = session();
    enqueue(id, { id: "user-1", text: "old" });
    db.prepare(`UPDATE chat_queue SET created_at = ? WHERE session_id = ?`).run(
      Date.now() - 2 * 60 * 60 * 1000,
      id
    );
    const commands = live(id);
    await reattachChats();
    expect(commands).toEqual([]);
    registry.live.delete(id);
  });
});

// Whether a tool is on this machine: ripgrep isn't on every CI runner.
const has = (cmd: string) => {
  try {
    execFileSync(cmd, ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
};

describe("a worker that goes away with messages queued", () => {
  it("is replaced to send them, at most once a minute, unless let go", async () => {
    db.prepare(`DELETE FROM chat_queue`).run();
    const id = session();
    enqueue(id, { id: "user-1", text: "queued" });
    const t0 = Date.now();
    vi.useFakeTimers({ toFake: ["Date"], now: t0 });
    try {
      // On start, a fresh worker is told to send it.
      await reattachChats();
      const mine = () => workers.started.filter((w) => w.sessionId === id);
      expect(mine()).toHaveLength(1);
      expect(mine()[0].commands.at(-1)).toEqual({ type: "drain" });
      expect(queueCommands(mine()[0].commands)).toEqual([{ type: "drain" }]);

      // Its agent dies: within the minute, no new one (no restart loop).
      mine()[0].handlers.onClose(false);
      await new Promise((r) => setTimeout(r, 0));
      expect(mine()).toHaveLength(1);

      // After it, a fresh worker takes the queue.
      vi.setSystemTime(t0 + 61_000);
      mine()[0].handlers.onClose(false);
      await new Promise((r) => setTimeout(r, 0));
      expect(mine()).toHaveLength(2);
      expect(mine()[1].commands.at(-1)).toEqual({ type: "drain" });
      expect(queueCommands(mine()[1].commands)).toEqual([{ type: "drain" }]);

      // One this server let go (stopped, retired) stays stopped.
      vi.setSystemTime(t0 + 122_000);
      mine()[1].handlers.onClose(true);
      await new Promise((r) => setTimeout(r, 0));
      expect(mine()).toHaveLength(2);
    } finally {
      vi.useRealTimers();
      registry.live.delete(id);
    }
  });
});

describe("a session switched to the terminal", () => {
  it("keeps its queue on screen, and never gets a chat worker for it", async () => {
    db.prepare(`DELETE FROM chat_queue`).run();
    const id = session();
    enqueue(id, { id: "user-1", text: "queued" });
    db.prepare(`UPDATE sessions SET view = 'terminal' WHERE id = ?`).run(id);
    const t0 = Date.now();
    vi.useFakeTimers({ toFake: ["Date"], now: t0 });
    try {
      await reattachChats();
      expect(workers.started.filter((w) => w.sessionId === id)).toEqual([]);
      expect(listQueue(id).map((m) => m.text)).toEqual(["queued"]);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("a worker that goes away from a session no longer in chat", () => {
  it.each([
    [
      "switched to the terminal",
      `UPDATE sessions SET view = 'terminal' WHERE id = ?`,
    ],
    [
      "archived",
      `UPDATE sessions SET archived_at = datetime('now') WHERE id = ?`,
    ],
  ])("isn't replaced when the session was %s", async (_why, change) => {
    db.prepare(`DELETE FROM chat_queue`).run();
    const id = session();
    enqueue(id, { id: "user-1", text: "queued" });
    const t0 = Date.now();
    vi.useFakeTimers({ toFake: ["Date"], now: t0 });
    try {
      await reattachChats();
      const mine = () => workers.started.filter((w) => w.sessionId === id);
      expect(mine()).toHaveLength(1);
      db.prepare(change).run(id);
      vi.setSystemTime(t0 + 61_000);
      mine()[0].handlers.onClose(false);
      await new Promise((r) => setTimeout(r, 0));
      expect(mine()).toHaveLength(1);
      expect(listQueue(id).map((m) => m.text)).toEqual(["queued"]);
    } finally {
      vi.useRealTimers();
      registry.live.delete(id);
    }
  });
});

describe("a worker from an older build", () => {
  it("hands what its dead agent left queued to a current worker", async () => {
    db.prepare(`DELETE FROM chat_queue`).run();
    const id = session();
    enqueue(id, { id: "user-1", text: "queued" });
    const t0 = Date.now();
    vi.useFakeTimers({ toFake: ["Date"], now: t0 });
    // Mid-turn when this server comes up.
    workers.build = "an-older-build";
    workers.state = "running";
    try {
      await reattachChats();
      const mine = () => workers.started.filter((w) => w.sessionId === id);
      expect(mine()).toHaveLength(1);
      // Its agent died mid-turn: idle, with the message still queued.
      workers.build = undefined;
      workers.state = "idle";
      vi.setSystemTime(t0 + 61_000);
      mine()[0].handlers.onEvent({ type: "state", state: "idle" });
      await new Promise((r) => setTimeout(r, 0));
      expect(mine()[0].commands).toContainEqual({ type: "close" });
      expect(mine()).toHaveLength(2);
      expect(mine()[1].commands.at(-1)).toEqual({ type: "drain" });
      expect(queueCommands(mine()[1].commands)).toEqual([{ type: "drain" }]);
    } finally {
      workers.build = undefined;
      workers.state = "idle";
      vi.useRealTimers();
      registry.live.delete(id);
    }
  });
});

describe("a worker from an older build whose turn ends", () => {
  // Attached mid-turn, on code from before a redeploy.
  async function staleMidTurn() {
    db.prepare(`DELETE FROM chat_queue`).run();
    const id = session();
    workers.running = [id];
    workers.build = "an-older-build";
    workers.state = "running";
    await reattachChats();
    workers.running = [];
    workers.build = undefined;
    workers.state = "idle";
    const mine = () => workers.started.filter((w) => w.sessionId === id);
    const closed = (i: number) =>
      mine()[i].commands.some((c) => (c as { type: string }).type === "close");
    return { id, mine, closed, worker: mine()[0] };
  }

  it("stays for its guess at the next message, then goes", async () => {
    const { id, mine, closed, worker } = await staleMidTurn();
    try {
      worker.handlers.onEvent({ type: "state", state: "idle" });
      expect(closed(0)).toBe(false);
      worker.handlers.onEvent({ type: "suggestion", text: "run the tests" });
      expect(closed(0)).toBe(true);
      expect(registry.live.has(id)).toBe(false);
      expect(mine()).toHaveLength(1);
    } finally {
      registry.live.delete(id);
    }
  });

  it("goes after a while when no guess comes", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { id, closed, worker } = await staleMidTurn();
    try {
      worker.handlers.onEvent({ type: "state", state: "idle" });
      await vi.advanceTimersByTimeAsync(60_000);
      expect(closed(0)).toBe(false);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(closed(0)).toBe(true);
    } finally {
      vi.useRealTimers();
      registry.live.delete(id);
    }
  });

  it("hands a message sent meanwhile to a current worker", async () => {
    const { id, mine, closed, worker } = await staleMidTurn();
    try {
      worker.handlers.onEvent({ type: "state", state: "idle" });
      await sendChat(id, { text: "next" });
      expect(closed(0)).toBe(true);
      expect(mine()).toHaveLength(2);
      expect(mine()[0].commands).not.toContainEqual(
        expect.objectContaining({ type: "send" })
      );
      expect(mine()[1].commands).toContainEqual(
        expect.objectContaining({ type: "send", text: "next" })
      );
    } finally {
      registry.live.delete(id);
    }
  });

  it("keeps a turn the agent starts meanwhile", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { id, closed, worker } = await staleMidTurn();
    try {
      worker.handlers.onEvent({ type: "state", state: "idle" });
      worker.handlers.onEvent({ type: "state", state: "running" });
      await vi.advanceTimersByTimeAsync(5 * 60_000);
      expect(closed(0)).toBe(false);
    } finally {
      vi.useRealTimers();
      registry.live.delete(id);
    }
  });
});

describe("listFiles", () => {
  for (const [cmd, args] of LISTERS)
    it.skipIf(!has(cmd))(
      `lists a folder with ${cmd}, leaving ignored files out`,
      async () => {
        const all = (await listFiles(repo(), [[cmd, args]])).map(
          (p) => p.file.path
        );
        expect(all).toEqual(
          expect.arrayContaining(["lib", "lib/queue.ts", "notes.md"])
        );
        expect(all).not.toContain("secret.log");
      }
    );
});
