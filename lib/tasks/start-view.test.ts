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
    const task = await createTask({ projectId, prompt: "do x" });
    expect(task.view).toBe("chat");
  });

  it("is a terminal when picked", async () => {
    const task = await createTask({
      projectId,
      prompt: "do y",
      view: "terminal",
    });
    expect(task.view).toBe("terminal");
  });
});
