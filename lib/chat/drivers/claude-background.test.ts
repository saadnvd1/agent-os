import { describe, expect, it, vi } from "vitest";

const backgroundTasks = vi.hoisted(() => vi.fn());

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  getSessionMessages: vi.fn(),
  query: () => ({
    backgroundTasks,
    interrupt: async () => {},
    close: () => {},
    usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET: () =>
      new Promise(() => {}),
    [Symbol.asyncIterator]: () => ({ next: () => new Promise(() => {}) }),
  }),
}));

const { claudeDriver } = await import("./claude");

const start = () =>
  claudeDriver.start({ cwd: "/tmp", model: "sonnet", access: "full", env: {} });

describe("claude driver backgroundTask", () => {
  it("says it can, and moves the one call it is given", async () => {
    expect(claudeDriver.backgroundTasks).toBe(true);
    backgroundTasks.mockResolvedValueOnce(true);
    const c = start();
    await expect(c.backgroundTask?.("toolu_1")).resolves.toBe(true);
    expect(backgroundTasks).toHaveBeenLastCalledWith("toolu_1");
    c.close();
  });

  it("moves every call when none is named, and reports nothing moved", async () => {
    backgroundTasks.mockResolvedValueOnce(false);
    const c = start();
    await expect(c.backgroundTask?.()).resolves.toBe(false);
    expect(backgroundTasks).toHaveBeenLastCalledWith(undefined);
    c.close();
  });

  it("passes on a refusal (background tasks turned off)", async () => {
    backgroundTasks.mockRejectedValueOnce(new Error("disabled"));
    const c = start();
    await expect(c.backgroundTask?.("toolu_1")).rejects.toThrow("disabled");
    c.close();
  });
});
