import { beforeEach, describe, expect, it, vi } from "vitest";

const runner = vi.hoisted(() => ({
  state: null as string | null,
  sendChat: vi.fn(async () => {}),
  stopChat: vi.fn(),
}));
vi.mock("../chat/runner", () => ({
  chatState: () => runner.state,
  sendChat: runner.sendChat,
  stopChat: runner.stopChat,
}));
const live = vi.hoisted(() => new Map<string, unknown>());
vi.mock("../chat/registry", async (orig) => ({
  ...(await orig<typeof import("../chat/registry")>()),
  registry: { live, caps: new Map() },
}));

const { db } = await import("../db");
const { seedSession, seedWorkspace } = await import("../orchestrator/testing");
const { setModelSettings } = await import("./config");
const { PROVIDER_PRESETS } = await import("./providers");
const { mergeOverride, resumeOnModel } = await import("./resume");

function pausedTask() {
  const { app } = seedWorkspace();
  const id = seedSession({
    projectId: app.id,
    name: "paused",
    view: "chat",
    task: true,
  });
  db.prepare(
    `UPDATE sessions SET model = 'claude-opus-5-5', claude_session_id = 'conv-1', worktree_path = '/tmp/wt' WHERE id = ?`
  ).run(id);
  return id;
}

const row = (id: string) =>
  db
    .prepare(
      `SELECT model, model_provider, model_overrides, claude_session_id, worktree_path FROM sessions WHERE id = ?`
    )
    .get(id);

beforeEach(() => {
  runner.state = null;
  runner.sendChat.mockClear();
  runner.stopChat.mockClear();
  live.clear();
  setModelSettings({
    providers: [
      {
        ...PROVIDER_PRESETS.find((p) => p.id === "zai")!,
        auth: { kind: "keychain", service: "zai" },
        enabled: true,
      },
    ],
  });
});

describe("resume on model", () => {
  it("carries a paused task on in the same conversation and worktree", async () => {
    const id = pausedTask();
    const out = await resumeOnModel(id, "anthropic/claude-sonnet-5-5");
    expect(out).toEqual({ ref: "anthropic/claude-sonnet-5-5", resumed: true });
    expect(row(id)).toEqual({
      model: "claude-sonnet-5-5",
      model_provider: null,
      model_overrides: JSON.stringify("anthropic/claude-sonnet-5-5"),
      claude_session_id: "conv-1",
      worktree_path: "/tmp/wt",
    });
    expect(runner.sendChat).toHaveBeenCalledWith(
      id,
      expect.objectContaining({
        text: expect.stringContaining("Carry on where you left off"),
      })
    );
    // Same provider: nothing to restart.
    expect(runner.stopChat).not.toHaveBeenCalled();
  });

  it("restarts a live worker when the provider changes, so the endpoint and key change with it", async () => {
    const id = pausedTask();
    live.set(id, {});
    await resumeOnModel(id, "zai/glm-5.3", "Finish the tests.");
    expect(row(id)).toMatchObject({
      model: "glm-5.3",
      model_provider: "zai",
      claude_session_id: "conv-1",
    });
    expect(runner.stopChat).toHaveBeenCalledWith(id);
    expect(runner.sendChat).toHaveBeenCalledWith(
      id,
      expect.objectContaining({ text: "Finish the tests." })
    );
  });

  it("refuses mid-turn, and a model it can't use", async () => {
    const id = pausedTask();
    runner.state = "running";
    await expect(
      resumeOnModel(id, "anthropic/claude-sonnet-5-5")
    ).rejects.toThrow(/mid-turn/);
    runner.state = null;
    await expect(resumeOnModel(id, "deepseek/deepseek-v4-pro")).rejects.toThrow(
      /turned off/
    );
    expect(row(id)).toMatchObject({
      model: "claude-opus-5-5",
      model_overrides: null,
    });
  });

  it("sets the model of one that hasn't launched, without a message", async () => {
    const id = pausedTask();
    db.prepare(`UPDATE sessions SET setup_status = 'held' WHERE id = ?`).run(
      id
    );
    expect(await resumeOnModel(id, "zai/glm-5.3")).toEqual({
      ref: "zai/glm-5.3",
      resumed: false,
    });
    expect(row(id)).toMatchObject({ model: "glm-5.3", model_provider: "zai" });
    expect(runner.sendChat).not.toHaveBeenCalled();
  });

  it("adds a role map to the one it has; one model replaces it", () => {
    expect(
      mergeOverride({ plan: "zai/glm-5.3" }, { implement: "anthropic/opus" })
    ).toEqual({ plan: "zai/glm-5.3", implement: "anthropic/opus" });
    expect(mergeOverride({ plan: "zai/glm-5.3" }, "anthropic/opus")).toBe(
      "anthropic/opus"
    );
  });
});
