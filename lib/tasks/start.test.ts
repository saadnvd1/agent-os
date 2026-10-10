import { beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type { SetupResult } from "../env-setup";

// Prompt files land here, not in the real ~/.agent-os.
const prompts = fs.mkdtempSync(path.join(os.tmpdir(), "aos-prompts-"));
const promptFile = (id: string) => path.join(prompts, `${id}.prompt.md`);
// Every tmux call start.ts makes, in order.
const tmuxCalls: string[][] = [];
vi.mock("child_process", async (importOriginal) => ({
  ...(await importOriginal<typeof import("child_process")>()),
  execFile: (
    cmd: string,
    args: string[],
    _opts: unknown,
    cb: (e: Error | null, out: { stdout: string; stderr: string }) => void
  ) => {
    if (cmd === "tmux") tmuxCalls.push(args);
    cb(null, { stdout: "", stderr: "" });
  },
}));

const setupWorktree = vi.fn<() => Promise<SetupResult>>();
const launchClaude =
  vi.fn<(opts: { prompt: string; brief?: string }) => Promise<void>>();
vi.mock("../env-setup", () => ({ setupWorktree: () => setupWorktree() }));
vi.mock("../agents/launch", () => ({
  launchClaude: (opts: { prompt: string; brief?: string }) =>
    launchClaude(opts),
  promptFileFor: (id: string) => promptFile(id),
}));

// A chat worker taking a queued message: it leaves the queue and becomes
// the chat's first item.
const sendQueuedNow = vi.fn(async (sessionId: string, id: string) => {
  const { deleteQueued } = await import("../chat/queued");
  const { saveItem } = await import("../chat/store");
  deleteQueued(sessionId, id);
  saveItem(sessionId, {
    id,
    kind: "user",
    text: "sent",
    createdAt: Date.now(),
  });
});
vi.mock("../chat/runner", () => ({
  sendQueuedNow: (sessionId: string, id: string) =>
    sendQueuedNow(sessionId, id),
}));

const { db } = await import("../db");
const { seedSession, seedWorkspace } = await import("../orchestrator/testing");
const { setPaused } = await import("../orchestrator/pause");
const { taskSetupOf } = await import("./setup");
const { listQueue } = await import("../chat/queued");
const { itemsOfKind } = await import("../chat/store");
const {
  finishTaskStart,
  firstMessageId,
  launchHold,
  launchPending,
  resumeHeldStarts,
  resumeTaskStarts,
} = await import("./start");

const ok = (): SetupResult => ({
  success: true,
  steps: [],
  envFilesCopied: [],
  durationMs: 42,
});

function seedTask(projectId: string): string {
  const id = seedSession({ projectId, name: "task", task: true });
  db.prepare(
    `UPDATE sessions SET worktree_path = '/tmp/wt', task_prompt = 'Do it',
       task_brief = 'The brief', setup_status = 'running' WHERE id = ?`
  ).run(id);
  return id;
}

const setupOf = (id: string) =>
  taskSetupOf(
    db.prepare(`SELECT * FROM sessions WHERE id = ?`).get(id) as object
  );

function seedChatTask(projectId: string): string {
  const id = seedTask(projectId);
  db.prepare(`UPDATE sessions SET view = 'chat' WHERE id = ?`).run(id);
  return id;
}

let ws: ReturnType<typeof seedWorkspace>;
beforeEach(() => {
  sendQueuedNow.mockClear();
  setupWorktree.mockReset().mockResolvedValue(ok());
  launchClaude.mockReset().mockResolvedValue();
  tmuxCalls.length = 0;
  ws = seedWorkspace();
});

describe("finishTaskStart", () => {
  it("launches after setup with the stored prompt and brief, then records it", async () => {
    const id = seedTask(ws.app.id);
    let setupDone = false;
    setupWorktree.mockImplementation(async () => ((setupDone = true), ok()));
    launchClaude.mockImplementation(async () => {
      expect(setupDone).toBe(true);
      expect(setupOf(id)?.status).toBe("running");
    });
    await finishTaskStart(id);
    expect(launchClaude).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: "Do it", brief: "The brief" })
    );
    expect(setupOf(id)).toEqual({ status: "ok", ms: 42, error: null });
  });

  it("still launches after a failed setup, and tells the agent", async () => {
    const id = seedTask(ws.app.id);
    setupWorktree.mockResolvedValue({
      ...ok(),
      success: false,
      steps: [{ name: "i", command: "npm ci", success: false, error: "E404" }],
    });
    await finishTaskStart(id);
    expect(launchClaude.mock.calls[0][0].prompt).toContain("E404");
    expect(setupOf(id)?.status).toBe("failed");
  });

  it("records a launch that failed", async () => {
    const id = seedTask(ws.app.id);
    launchClaude.mockRejectedValue(new Error("duplicate session"));
    await finishTaskStart(id);
    expect(setupOf(id)?.error).toMatch(/did not launch: duplicate session/);
  });

  it("holds a start the orchestrator made while it's paused", async () => {
    const id = seedTask(ws.app.id);
    db.prepare(
      `INSERT INTO orchestrator_starts (workspace_id, kind, target, created_at) VALUES (?, 'task', ?, datetime('now'))`
    ).run(ws.workspace.id, id);
    expect(launchHold(id)).toBeNull();
    setPaused(ws.workspace.id, true);
    expect(launchHold(id)).toMatch(/paused/);
    await finishTaskStart(id);
    expect(launchClaude).not.toHaveBeenCalled();
    expect(setupOf(id)?.status).toBe("held");
    expect(setupOf(id)?.error).toBeNull();
  });

  it("holds a card of a stack the orchestrator started, and only that stack's", async () => {
    const id = seedTask(ws.app.id);
    const other = seedTask(ws.app.id);
    const stack = `st-${id.slice(0, 8)}`;
    db.prepare(
      `INSERT INTO stacks (id, project_id, lh_board_id, name) VALUES (?, ?, 'b', 'S')`
    ).run(stack, ws.app.id);
    db.prepare(
      `INSERT INTO stack_items (id, stack_id, position, lh_card_id, title, session_id) VALUES (?, ?, 0, 'c', 'Card', ?)`
    ).run(`it-${id.slice(0, 8)}`, stack, id);
    db.prepare(
      `INSERT INTO orchestrator_starts (workspace_id, kind, target, created_at) VALUES (?, 'stack', ?, datetime('now'))`
    ).run(ws.workspace.id, stack);
    setPaused(ws.workspace.id, true);
    expect(launchHold(other)).toBeNull();
    await finishTaskStart(id);
    expect(launchClaude).not.toHaveBeenCalled();
    expect(setupOf(id)?.status).toBe("held");
  });

  it("launches a held start once the pause lifts, once", async () => {
    const id = seedTask(ws.app.id);
    db.prepare(
      `INSERT INTO orchestrator_starts (workspace_id, kind, target, created_at) VALUES (?, 'task', ?, datetime('now'))`
    ).run(ws.workspace.id, id);
    setPaused(ws.workspace.id, true);
    await finishTaskStart(id);
    expect(resumeHeldStarts()).not.toContain(id);
    setPaused(ws.workspace.id, false);
    expect(resumeHeldStarts()).toContain(id);
    expect(resumeHeldStarts()).not.toContain(id);
    await vi.waitFor(() => expect(setupOf(id)?.status).toBe("ok"));
    expect(launchClaude).toHaveBeenCalledTimes(1);
    // Setup commands needn't be idempotent: the held start doesn't rerun them.
    expect(setupWorktree).toHaveBeenCalledTimes(1);
  });

  it("keeps a held start's setup failure for the agent's prompt", async () => {
    const id = seedTask(ws.app.id);
    db.prepare(
      `INSERT INTO orchestrator_starts (workspace_id, kind, target, created_at) VALUES (?, 'task', ?, datetime('now'))`
    ).run(ws.workspace.id, id);
    setupWorktree.mockResolvedValue({
      ...ok(),
      success: false,
      steps: [{ name: "i", command: "npm ci", success: false, error: "E404" }],
    });
    setPaused(ws.workspace.id, true);
    await finishTaskStart(id);
    expect(launchPending(id)).toBe(true);
    setPaused(ws.workspace.id, false);
    resumeHeldStarts();
    await vi.waitFor(() => expect(launchClaude).toHaveBeenCalledTimes(1));
    expect(launchClaude.mock.calls[0][0].prompt).toContain("E404");
    expect(setupWorktree).toHaveBeenCalledTimes(1);
  });

  it("replaces a tmux session opened before the launch", async () => {
    const id = seedTask(ws.app.id);
    expect(launchPending(id)).toBe(true);
    launchClaude.mockImplementation(async () => {
      expect(tmuxCalls).toEqual([["kill-session", "-t", `=claude-${id}`]]);
    });
    await finishTaskStart(id);
    expect(setupOf(id)?.status).toBe("ok");
    expect(launchPending(id)).toBe(false);
  });

  it("doesn't launch a task closed during its setup", async () => {
    const id = seedTask(ws.app.id);
    setupWorktree.mockImplementation(async () => {
      db.prepare(
        `UPDATE sessions SET task_status = 'dropped' WHERE id = ?`
      ).run(id);
      return ok();
    });
    await finishTaskStart(id);
    expect(launchClaude).not.toHaveBeenCalled();
    expect(setupOf(id)?.error).toMatch(/closed during setup/);
  });

  it("never holds a task a person started", () => {
    const id = seedTask(ws.app.id);
    setPaused(ws.workspace.id, true);
    expect(launchHold(id)).toBeNull();
  });
});

describe("resumeTaskStarts", () => {
  it("doesn't relaunch a start whose agent is already up", async () => {
    // Only this test's row is a cut-off start.
    db.prepare(
      `UPDATE sessions SET setup_status = 'ok' WHERE setup_status IN ('running', 'held')`
    ).run();
    const live = seedTask(ws.app.id);
    fs.writeFileSync(promptFile(live), "Do it");
    const resumed = await resumeTaskStarts(
      async (name) => name === `claude-${live}`
    );
    expect(resumed).not.toContain(live);
    expect(setupOf(live)).toEqual({ status: "ok", ms: null, error: null });
    expect(setupWorktree).not.toHaveBeenCalled();
  });

  it("doesn't rerun setup for a held start a restart cut off after its claim", async () => {
    db.prepare(
      `UPDATE sessions SET setup_status = 'ok' WHERE setup_status IN ('running', 'held')`
    ).run();
    const id = seedTask(ws.app.id);
    // Set up, held, then claimed by the tick: running again, with its setup.
    db.prepare(
      `UPDATE sessions SET setup_status = 'running', setup_ms = 42, setup_error = NULL WHERE id = ?`
    ).run(id);
    expect(await resumeTaskStarts(async () => false)).toEqual([id]);
    await vi.waitFor(() => expect(launchClaude).toHaveBeenCalledTimes(1));
    expect(setupWorktree).not.toHaveBeenCalled();
  });

  it("relaunches a start whose tmux session isn't the agent's", async () => {
    db.prepare(
      `UPDATE sessions SET setup_status = 'ok' WHERE setup_status IN ('running', 'held')`
    ).run();
    // Opened from the sidebar mid-setup: alive, but no prompt was written.
    const bare = seedTask(ws.app.id);
    const resumed = await resumeTaskStarts(async () => true);
    expect(resumed).toEqual([bare]);
    await vi.waitFor(() => expect(launchClaude).toHaveBeenCalledTimes(1));
  });

  it("resumes only starts a restart cut off", async () => {
    const cut = seedTask(ws.app.id);
    const finished = seedTask(ws.app.id);
    db.prepare(`UPDATE sessions SET setup_status = 'ok' WHERE id = ?`).run(
      finished
    );
    const dropped = seedTask(ws.app.id);
    db.prepare(`UPDATE sessions SET task_status = 'dropped' WHERE id = ?`).run(
      dropped
    );

    const resumed = await resumeTaskStarts(async () => false);
    expect(resumed).toContain(cut);
    expect(resumed).not.toContain(finished);
    expect(resumed).not.toContain(dropped);
    await vi.waitFor(() => expect(setupOf(cut)?.status).toBe("ok"));
  });
});

describe("a chat task's start, beside a terminal task's", () => {
  it("sends the same prompt as the chat's first message, with no terminal", async () => {
    const terminal = seedTask(ws.app.id);
    const chat = seedChatTask(ws.app.id);
    await finishTaskStart(terminal);
    await finishTaskStart(chat);
    expect(launchClaude).toHaveBeenCalledTimes(1);
    expect(launchClaude.mock.calls[0][0].prompt).toBe("Do it");
    expect(tmuxCalls.flat().join(" ")).not.toContain(chat);
    expect(sendQueuedNow).toHaveBeenCalledWith(chat, firstMessageId(chat));
    expect(itemsOfKind(chat, "user").map((i) => i.id)).toEqual([
      firstMessageId(chat),
    ]);
    expect(setupOf(terminal)?.status).toBe("ok");
    expect(setupOf(chat)?.status).toBe("ok");
  });

  it("tells both agents about a failed setup", async () => {
    setupWorktree.mockResolvedValue({
      ...ok(),
      success: false,
      steps: [{ name: "i", command: "npm ci", success: false, error: "E404" }],
    });
    const terminal = seedTask(ws.app.id);
    const chat = seedChatTask(ws.app.id);
    let sent = "";
    sendQueuedNow.mockImplementationOnce(async (sessionId, id) => {
      sent = listQueue(sessionId).find((m) => m.id === id)?.text ?? "";
    });
    await finishTaskStart(terminal);
    await finishTaskStart(chat);
    expect(launchClaude.mock.calls[0][0].prompt).toContain("E404");
    expect(sent).toContain("E404");
    expect(setupOf(chat)?.error).not.toMatch(/did not launch/);
  });

  it("records a chat launch that failed, as a terminal's", async () => {
    const chat = seedChatTask(ws.app.id);
    sendQueuedNow.mockRejectedValueOnce(new Error("worker didn't start"));
    await finishTaskStart(chat);
    expect(setupOf(chat)?.error).toMatch(/did not launch: worker didn't start/);
  });

  it("after a restart, relaunches only the start whose message wasn't taken, once", async () => {
    db.prepare(
      `UPDATE sessions SET setup_status = 'ok' WHERE setup_status IN ('running', 'held')`
    ).run();
    const taken = seedChatTask(ws.app.id);
    await finishTaskStart(taken);
    db.prepare(`UPDATE sessions SET setup_status = 'running' WHERE id = ?`).run(
      taken
    );
    const cut = seedChatTask(ws.app.id);
    const resumed = await resumeTaskStarts(async () => false);
    expect(resumed).toEqual([cut]);
    await vi.waitFor(() => expect(setupOf(cut)?.status).toBe("ok"));
    // A second resume of the same start finds its message taken.
    await finishTaskStart(cut);
    expect(itemsOfKind(cut, "user")).toHaveLength(1);
    expect(setupOf(taken)?.status).toBe("ok");
    expect(launchClaude).not.toHaveBeenCalled();
  });

  it("after a restart, sends a first message still queued without setting up again", async () => {
    db.prepare(
      `UPDATE sessions SET setup_status = 'ok' WHERE setup_status IN ('running', 'held')`
    ).run();
    const id = seedChatTask(ws.app.id);
    // Cut off between queueing the message and the worker taking it.
    sendQueuedNow.mockImplementationOnce(async () => {});
    await finishTaskStart(id);
    db.prepare(`UPDATE sessions SET setup_status = 'running' WHERE id = ?`).run(
      id
    );
    setupWorktree.mockClear();
    sendQueuedNow.mockClear();
    const resumed = await resumeTaskStarts(async () => false);
    expect(resumed).not.toContain(id);
    expect(setupWorktree).not.toHaveBeenCalled();
    expect(setupOf(id)?.status).toBe("ok");
    expect(sendQueuedNow).toHaveBeenCalledWith(id, firstMessageId(id));
    await vi.waitFor(() => expect(itemsOfKind(id, "user")).toHaveLength(1));
  });
});
