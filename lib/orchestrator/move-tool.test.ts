import fs from "fs";
import os from "os";
import path from "path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { seedWorkspace } from "./testing";

const moved = vi.hoisted(() => ({ calls: [] as string[][], fail: false }));
vi.mock("@/lib/tasks", async (orig) => ({
  ...(await orig<typeof import("@/lib/tasks")>()),
  moveTask: async (id: string, host: string) => {
    moved.calls.push([id, host]);
    if (moved.fail) throw new Error("box is full");
    return { id: `${id}-there` };
  },
}));

const { db, updateSessionRow } = await import("@/lib/db");
const { createHost } = await import("@/lib/hosts");
const { ensureOrchestrator } = await import("./home");
const { runTool } = await import("./serve");
const { setPaused } = await import("./pause");
const { pendingEvents } = await import("./events");
const { scopeOf } = await import("@/lib/done/bulk");

beforeAll(() => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "aos-orch-move-"));
  vi.spyOn(os, "homedir").mockReturnValue(home);
});

function setup() {
  const ws = seedWorkspace();
  const orch = ensureOrchestrator(ws.workspace.id);
  createHost("box", "alice@devbox");
  updateSessionRow(db, ws.task, { started_by: orch.id, task_prompt: "x" });
  return { ...ws, orch };
}

describe("the move tool", () => {
  it("moves one of the workspace's tasks and says when it lands", async () => {
    const t = setup();
    moved.calls = [];
    const said = await runTool(t.workspace.id, "move", {
      task: "add-auth",
      machine: "box",
    });
    expect(said).toMatch(/Moving add-auth to box/);
    await vi.waitFor(() =>
      expect(
        pendingEvents(t.workspace.id).some((e) => e.key.includes("move:"))
      ).toBe(true)
    );
    expect(moved.calls).toHaveLength(1);
    expect(moved.calls[0][0]).toBe(t.task);
  });

  it("queues an event when the move fails", async () => {
    const t = setup();
    moved.fail = true;
    await runTool(t.workspace.id, "move", { task: "add-auth", machine: "box" });
    moved.fail = false;
    await vi.waitFor(() =>
      expect(
        pendingEvents(t.workspace.id).some((e) =>
          e.key.includes("move-failed:")
        )
      ).toBe(true)
    );
  });

  it("is held by Pause and refuses a machine it doesn't know", async () => {
    const t = setup();
    moved.calls = [];
    await expect(
      runTool(t.workspace.id, "move", { task: "add-auth", machine: "nowhere" })
    ).rejects.toThrow();
    setPaused(t.workspace.id, true);
    await expect(
      runTool(t.workspace.id, "move", { task: "add-auth", machine: "box" })
    ).rejects.toThrow(/paused/i);
    expect(moved.calls).toEqual([]);
  });

  it("won't reach a task of another workspace", async () => {
    const t = setup();
    const other = seedWorkspace();
    ensureOrchestrator(other.workspace.id);
    await expect(
      runTool(other.workspace.id, "move", {
        task: t.task,
        machine: "box",
      })
    ).rejects.toThrow();
  });

  it("keeps aos's own move, done and stop closed to an orchestrator", () => {
    const t = setup();
    expect(() =>
      scopeOf({ id: t.orch.id, role: "orchestrator" } as never)
    ).toThrow(/move|done|stop/);
  });
});
