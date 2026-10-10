import { describe, expect, it, vi } from "vitest";
import type { ChatItem } from "./events";
import type { WorkerHandlers } from "./worker/client";

// Workers are faked: each takes a message the way a real one does, by
// recording it as a user item, and remembers what it was sent.
const workers = vi.hoisted(() => ({
  running: [] as string[],
  // The build workers report; undefined for this server's own.
  build: undefined as string | undefined,
  state: "idle" as "idle" | "running",
  started: [] as {
    sessionId: string;
    handlers: WorkerHandlers;
    commands: { type: string; id?: string; text?: string }[];
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
    const { saveItem } = await import("./store");
    const started = {
      sessionId,
      handlers,
      commands: [] as { type: string; id?: string; text?: string }[],
    };
    workers.started.push(started);
    return {
      client: {
        command: (cmd: { type: string; id?: string; text?: string }) => {
          started.commands.push(cmd);
          if (cmd.type !== "send") return;
          const item = {
            id: cmd.id!,
            kind: "user" as const,
            text: cmd.text!,
            createdAt: Date.now(),
          };
          saveItem(sessionId, item);
          handlers.onEvent({ type: "item", item });
        },
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
const { saveItem } = await import("./store");
const { reattachChats } = await import("./runner");
const { RESUME_NOTE } = await import("./interrupted");
const { seedSession, seedWorkspace } = await import("../orchestrator/testing");

let at = Date.now() - 60_000;
const item = (i: Partial<ChatItem> & Pick<ChatItem, "id" | "kind">) =>
  ({ createdAt: at++, ...i }) as ChatItem;

// A chat task in a workspace, with a turn that ran a tool.
function task(): { id: string; w: string } {
  const { workspace, app } = seedWorkspace();
  const id = seedSession({
    projectId: app.id,
    name: "fix-it",
    view: "chat",
    task: true,
  });
  saveItem(id, item({ id: "user-1", kind: "user", text: "fix it" }));
  saveItem(
    id,
    item({
      id: "tool-1",
      kind: "tool",
      title: "npm test",
      status: "running",
    } as Partial<ChatItem> & Pick<ChatItem, "id" | "kind">)
  );
  return { id, w: workspace.id };
}

const sends = (id: string) =>
  workers.started
    .filter((w) => w.sessionId === id)
    .flatMap((w) => w.commands)
    .filter((c) => c.type === "send");

const events = (w: string, id: string) =>
  (
    db
      .prepare(
        `SELECT line FROM orchestrator_events WHERE workspace_id = ? AND subject = ?`
      )
      .all(w, id) as { line: string }[]
  ).map((e) => e.line);

function forget(id: string) {
  registry.live.delete(id);
  db.prepare(
    `UPDATE sessions SET archived_at = datetime('now') WHERE id = ?`
  ).run(id);
}

describe("a turn a restart cut off", () => {
  it("is resumed exactly once, and its orchestrator hears", async () => {
    const { id, w } = task();
    try {
      await reattachChats();
      expect(sends(id)).toEqual([
        expect.objectContaining({
          id: "user-resume-tool-1",
          text: RESUME_NOTE,
        }),
      ]);
      expect(events(w, id)).toEqual([
        "task fix-it: interrupted by a restart, resumed",
      ]);
      // Another restart before the resumed turn writes anything: the note
      // isn't sent again.
      registry.live.delete(id);
      await reattachChats();
      expect(sends(id)).toHaveLength(1);
    } finally {
      forget(id);
    }
  });

  it("is left for the orchestrator when the resumed turn is cut off too", async () => {
    const { id, w } = task();
    try {
      await reattachChats();
      saveItem(id, item({ id: "a-2", kind: "assistant", text: "Rerunning" }));
      registry.live.delete(id);
      await reattachChats();
      expect(sends(id)).toHaveLength(1);
      expect(events(w, id)).toContain(
        "task fix-it: interrupted again after resuming; it's idle until told to carry on"
      );
    } finally {
      forget(id);
    }
  });

  it("isn't repeated when the turn finished", async () => {
    const { id, w } = task();
    try {
      saveItem(id, item({ id: "end-1", kind: "turn_end" }));
      await reattachChats();
      expect(sends(id)).toEqual([]);
      expect(events(w, id)).toEqual([]);
    } finally {
      forget(id);
    }
  });

  it("is left to a worker that's still running it", async () => {
    const { id } = task();
    workers.running = [id];
    workers.state = "running";
    try {
      await reattachChats();
      expect(sends(id)).toEqual([]);
    } finally {
      workers.running = [];
      workers.state = "idle";
      forget(id);
    }
  });
});

describe("a cut-off turn that isn't resumed", () => {
  it("is one from over an hour ago", async () => {
    const { id } = task();
    db.prepare(
      `UPDATE chat_items SET data = json_set(data, '$.createdAt', ?) WHERE session_id = ?`
    ).run(Date.now() - 2 * 60 * 60 * 1000, id);
    try {
      await reattachChats();
      expect(sends(id)).toEqual([]);
    } finally {
      forget(id);
    }
  });
});

describe("a local command after a finished turn", () => {
  it("isn't taken for a cut-off turn", async () => {
    const { id } = task();
    saveItem(id, item({ id: "end-1", kind: "turn_end" }));
    saveItem(id, item({ id: "user-mcp", kind: "user", text: "/mcp" }));
    saveItem(
      id,
      item({ id: "mcp-1", kind: "mcp", servers: [] } as Partial<ChatItem> &
        Pick<ChatItem, "id" | "kind">)
    );
    try {
      await reattachChats();
      expect(sends(id)).toEqual([]);
    } finally {
      forget(id);
    }
  });
});

describe("a turn that started over an hour ago", () => {
  it("is resumed when what it did last is recent", async () => {
    const { id } = task();
    db.prepare(
      `UPDATE sessions SET updated_at = datetime('now', '-3 hours') WHERE id = ?`
    ).run(id);
    try {
      await reattachChats();
      expect(sends(id)).toHaveLength(1);
    } finally {
      forget(id);
    }
  });
});

describe("a cut-off turn outside a task", () => {
  it("is resumed with no orchestrator event", async () => {
    const { id, w } = task();
    db.prepare(`UPDATE sessions SET task_status = NULL WHERE id = ?`).run(id);
    try {
      await reattachChats();
      expect(sends(id)).toHaveLength(1);
      expect(events(w, id)).toEqual([]);
    } finally {
      forget(id);
    }
  });
});

describe("a worker that dies mid-turn", () => {
  it("is replaced, and the agent told to carry on", async () => {
    const { id } = task();
    workers.running = [id];
    workers.state = "running";
    try {
      await reattachChats();
      workers.running = [];
      workers.state = "idle";
      const first = workers.started.filter((w) => w.sessionId === id)[0];
      // Its tmux server was killed: the socket drops, not let go.
      first.handlers.onClose(false);
      await vi.waitFor(() => expect(sends(id)).toHaveLength(1));
      expect(sends(id)[0].id).toBe("user-resume-tool-1");
    } finally {
      workers.running = [];
      workers.state = "idle";
      forget(id);
    }
  });
});

describe("a worker from an older build", () => {
  it("isn't retired while background work it runs is going", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { id } = task();
    saveItem(id, item({ id: "end-1", kind: "turn_end" }));
    const bg = {
      id: "task-1",
      kind: "task",
      taskId: "t1",
      description: "Verify findings",
      status: "running",
      createdAt: at++,
    } as unknown as ChatItem;
    saveItem(id, bg);
    workers.running = [id];
    workers.build = "an-older-build";
    try {
      await reattachChats();
      const mine = workers.started.filter((w) => w.sessionId === id);
      const closed = () =>
        mine.some((w) => w.commands.some((c) => c.type === "close"));
      // Idle between turns, its subagent still running: it stays.
      expect(mine).toHaveLength(1);
      expect(closed()).toBe(false);
      mine[0].handlers.onEvent({ type: "state", state: "idle" });
      await vi.advanceTimersByTimeAsync(10 * 60_000);
      expect(closed()).toBe(false);
      // The subagent reports back and its turn ends: then it goes.
      mine[0].handlers.onEvent({
        type: "item",
        item: { ...bg, status: "completed" } as ChatItem,
      });
      await vi.advanceTimersByTimeAsync(2 * 60_000);
      expect(closed()).toBe(true);
    } finally {
      vi.useRealTimers();
      workers.running = [];
      workers.build = undefined;
      forget(id);
    }
  });
});
