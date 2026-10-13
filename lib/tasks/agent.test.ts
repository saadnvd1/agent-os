import { describe, expect, it, vi } from "vitest";

// A task's agent: Claude Code unless a person picks another. The worktree
// and the launch are stubbed; the row is real.
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

describe("a task's agent", () => {
  const projectId = createProject({ name: "a", workingDirectory: "/tmp" }).id;

  it("is Claude Code when nobody picks", async () => {
    const task = await createTask({ projectId, prompt: "do x" });
    expect(task.agent_type).toBe("claude");
    expect(task.tmux_name).toMatch(/^claude-/);
  });

  it("is GitHub Copilot as a chat on its default model when picked", async () => {
    const task = await createTask({
      projectId,
      prompt: "do y",
      agent: "copilot",
    });
    expect(task).toMatchObject({
      agent_type: "copilot",
      view: "chat",
      model: "default",
      model_provider: null,
      plan_phase: null,
    });
    expect(task.tmux_name).toMatch(/^copilot-/);
  });

  it("keeps the model a person names for it", async () => {
    const task = await createTask({
      projectId,
      prompt: "do z",
      agent: "copilot",
      model: "gpt-6-luna",
    });
    expect(task.model).toBe("gpt-6-luna");
  });

  it("refuses what only Claude Code does", async () => {
    const make = (o: object) =>
      createTask({ projectId, prompt: "w", agent: "copilot", ...o });
    await expect(make({ view: "terminal" })).rejects.toThrow(/as a chat/);
    await expect(make({ plan: true })).rejects.toThrow(/plan first/);
    await expect(
      createTask({ projectId, prompt: "w", agent: "gemini" })
    ).rejects.toThrow(/can't run a task/);
  });
});
