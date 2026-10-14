import { describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { seedSession, seedWorkspace } from "./testing";

process.env.AGENTOS_LOAD = "off";

// The agent process is at the module edge.
vi.mock("@/lib/chat/runner", () => ({
  chatState: () => "idle",
  chatStateNow: () => "idle",
  releaseChat: async () => undefined,
  stopChat: () => undefined,
}));
vi.mock("@/lib/chat/stop", () => ({
  stopChatAtTurnEnd: async () => ({ stopped: true }),
  stopChatTurn: async () => ({ stopped: true }),
}));
vi.mock("@/lib/chat/worker/client", () => ({
  waitForExit: async () => undefined,
}));

const { runTool, TOOLS } = await import("./serve");
const { ensureOrchestrator } = await import("./home");
const { queueIfNeeded } = await import("@/lib/tasks/queue");
const { updateWorkspace } = await import("@/lib/workspaces");
const { requestPause } = await import("@/lib/tasks/pause");

const settle = () => new Promise((r) => setTimeout(r, 20));
const pauseState = (id: string) =>
  (
    db.prepare(`SELECT pause_state FROM sessions WHERE id = ?`).get(id) as {
      pause_state: string | null;
    }
  ).pause_state;

function setup() {
  const t = seedWorkspace();
  ensureOrchestrator(t.workspace.id);
  const id = seedSession({
    projectId: t.app.id,
    name: "worker",
    view: "chat",
    task: true,
  });
  return { ...t, id };
}

describe("the scheduling tools", () => {
  it("are registered", () => {
    for (const tool of ["set_priority", "pause_task", "resume_task"] as const)
      expect(TOOLS).toContain(tool);
  });

  it("pause_task pauses a task at its boundary, and resume_task lifts its own pause", async () => {
    const t = setup();
    const said = await runTool(t.workspace.id, "pause_task", {
      task: t.id,
      for: "2h",
      reason: "make room",
    });
    expect(said).toMatch(/Pausing worker at the end of its step/);
    await settle();
    expect(pauseState(t.id)).toBe("paused");
    expect(
      await runTool(t.workspace.id, "resume_task", { task: t.id })
    ).toMatch(/will resume/);
  });

  it("can't lift a pause a person set, and says so", async () => {
    const t = setup();
    requestPause(t.id, { until: null, by: "person" });
    await settle();
    await expect(
      runTool(t.workspace.id, "resume_task", { task: t.id })
    ).rejects.toThrow(/a person/);
  });

  it("refuses to resume what isn't paused and to pause what is waiting on Saad", async () => {
    const t = setup();
    await expect(
      runTool(t.workspace.id, "resume_task", { task: t.id })
    ).rejects.toThrow(/isn't paused/);
    db.prepare(`UPDATE sessions SET plan_phase = 'awaiting' WHERE id = ?`).run(
      t.id
    );
    await expect(
      runTool(t.workspace.id, "pause_task", {
        task: t.id,
        for: "1h",
        reason: "x",
      })
    ).rejects.toThrow(/waiting on you/);
  });

  it("refuses a bad duration", async () => {
    const t = setup();
    await expect(
      runTool(t.workspace.id, "pause_task", {
        task: t.id,
        for: "5y",
        reason: "x",
      })
    ).rejects.toThrow();
  });

  it("set_priority re-ranks a queued task by name and tags a running one", async () => {
    const t = setup();
    updateWorkspace(t.workspace.id, { maxRunningTasks: 1 });
    const q = queueIfNeeded({
      projectId: t.app.id,
      prompt: "queued thing",
      name: "queued thing",
    })!;
    expect(
      await runTool(t.workspace.id, "set_priority", {
        task: q.id.slice(0, 8),
        priority: "urgent",
      })
    ).toMatch(/urgent in the queue/);
    expect(
      db.prepare(`SELECT priority FROM task_queue WHERE id = ?`).get(q.id)
    ).toEqual({ priority: "urgent" });
    await runTool(t.workspace.id, "set_priority", {
      task: t.id,
      priority: "blocking",
    });
    expect(
      db.prepare(`SELECT priority FROM sessions WHERE id = ?`).get(t.id)
    ).toEqual({ priority: "blocking" });
  });

  it("a paused workspace refuses them like any acting tool", async () => {
    const t = setup();
    db.prepare(
      `UPDATE workspaces SET orch_paused_at = datetime('now') WHERE id = ?`
    ).run(t.workspace.id);
    await expect(
      runTool(t.workspace.id, "pause_task", {
        task: t.id,
        for: "1h",
        reason: "x",
      })
    ).rejects.toThrow(/paused/i);
  });
});
