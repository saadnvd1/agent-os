import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SetupResult } from "../env-setup";

const setupWorktree = vi.fn<() => Promise<SetupResult>>();
const launchClaude =
  vi.fn<(opts: { prompt: string; brief?: string }) => Promise<void>>();
vi.mock("../env-setup", () => ({ setupWorktree: () => setupWorktree() }));
vi.mock("../agents/launch", () => ({
  launchClaude: (opts: { prompt: string; brief?: string }) =>
    launchClaude(opts),
}));

const { db } = await import("../db");
const { seedSession, seedWorkspace } = await import("../orchestrator/testing");
const { setPaused } = await import("../orchestrator/pause");
const { taskSetupOf } = await import("./setup");
const { finishTaskStart, launchHold, resumeHeldStarts, resumeTaskStarts } =
  await import("./start");

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

let ws: ReturnType<typeof seedWorkspace>;
beforeEach(() => {
  setupWorktree.mockReset().mockResolvedValue(ok());
  launchClaude.mockReset().mockResolvedValue();
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
    expect(setupOf(id)?.error).toMatch(/^Waiting to launch: .*paused/);
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
    const resumed = await resumeTaskStarts(
      async (name) => name === `claude-${live}`
    );
    expect(resumed).not.toContain(live);
    expect(setupOf(live)).toEqual({ status: "ok", ms: null, error: null });
    expect(setupWorktree).not.toHaveBeenCalled();
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
