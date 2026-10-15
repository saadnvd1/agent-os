import { describe, expect, it, vi } from "vitest";

// What a task opens as when nobody picks: the one default new sessions use.
// The worktree and the launch are stubbed; the row is real.
vi.mock("../worktrees", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../worktrees")>()),
  createWorktree: async ({ featureName }: { featureName: string }) => ({
    worktreePath: `/tmp/wt-${featureName}`,
    branchName: `feature/${featureName}`,
  }),
}));
vi.mock("../git", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../git")>()),
  getDefaultBranch: async () => "main",
}));
vi.mock("../session-titles", () => ({
  nameFor: async () => ({ name: "A task", source: "user" }),
}));
vi.mock("./start", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./start")>()),
  finishTaskStart: async () => ({ status: "ok", ms: 0, error: null }),
}));

const { createTask } = await import("./index");
const { createProject } = await import("../projects");
const { DEFAULT_START_VIEW } = await import("../sessions/launch");

describe("a task's view", () => {
  const projectId = createProject({ name: "v", workingDirectory: "/tmp" }).id;

  it("is the shared default (chat) when nobody picks", async () => {
    expect(DEFAULT_START_VIEW).toBe("chat");
    const task = await createTask({
      startedVia: "person",
      projectId,
      prompt: "do x",
    });
    expect(task.view).toBe("chat");
  });

  it("is a terminal when picked", async () => {
    const task = await createTask({
      startedVia: "person",
      projectId,
      prompt: "do y",
      view: "terminal",
    });
    expect(task.view).toBe("terminal");
  });
});

describe("who started a task", () => {
  const projectId = createProject({ name: "s", workingDirectory: "/tmp" }).id;
  const row = async (id: string) => {
    const { db } = await import("../db");
    return db
      .prepare(
        `SELECT started_by, parent_session_id, started_via, started_by_device FROM session_rows WHERE id = ?`
      )
      .get(id);
  };

  it("a session that starts it is the starter and the parent", async () => {
    const { seedSession } = await import("../orchestrator/testing");
    const caller = seedSession({ projectId, name: "caller", task: true });
    const task = await createTask({
      projectId,
      prompt: "from a task",
      startedBy: caller,
      parentSessionId: caller,
      startedVia: "session",
    });
    expect(await row(task.id)).toEqual({
      started_by: caller,
      parent_session_id: caller,
      started_via: "session",
      started_by_device: null,
    });
  });

  it("a person on a device", async () => {
    const task = await createTask({
      projectId,
      prompt: "by hand",
      startedVia: "person",
      startedByDevice: "dev-1",
    });
    expect(await row(task.id)).toEqual({
      started_by: null,
      parent_session_id: null,
      started_via: "person",
      started_by_device: "dev-1",
    });
  });

  it("a piece is claimed for the new task, and a claimed one refuses a second", async () => {
    const { db } = await import("../db");
    const feature = "feat-" + Math.random();
    db.prepare(
      `INSERT INTO features (id, workspace_id, name, plan_session_id, plan_text, status)
       VALUES (?, 'ws', 'F', 'p', 'plan', 'building')`
    ).run(feature);
    const piece = Number(
      db
        .prepare(
          `INSERT INTO feature_pieces (feature_id, position, name, slice, project_id, status)
           VALUES (?, 2, 'ui', 's', ?, 'waiting')`
        )
        .run(feature, projectId).lastInsertRowid
    );
    const task = await createTask({
      projectId,
      prompt: "build ui",
      startedVia: "person",
      pieceId: piece,
    });
    expect(
      db
        .prepare(`SELECT status, session_id FROM feature_pieces WHERE id = ?`)
        .get(piece)
    ).toEqual({ status: "building", session_id: task.id });
    await expect(
      createTask({
        projectId,
        prompt: "again",
        startedVia: "person",
        pieceId: piece,
      })
    ).rejects.toThrow(/building, not waiting/);
  });
});
