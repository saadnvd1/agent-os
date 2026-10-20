import { describe, it, expect } from "vitest";
import {
  getDefaultModelForAgent,
  getModelOptions,
  resolveModelForAgent,
} from "./model-catalog";
import type { AgentType } from "./providers";

const AGENTS: AgentType[] = ["claude", "codex", "gemini"];

describe("model catalog", () => {
  it.each(AGENTS)("%s: the default is one of its options", (agent) => {
    const values = getModelOptions(agent).map((o) => o.value);
    expect(values).toContain(getDefaultModelForAgent(agent));
  });

  it.each(AGENTS)("%s: no duplicate model ids", (agent) => {
    const values = getModelOptions(agent).map((o) => o.value);
    expect(new Set(values).size).toBe(values.length);
  });

  it("defaults Claude to Opus", () => {
    expect(getDefaultModelForAgent("claude")).toBe("opus");
  });

  it("falls back to the default for a model that was removed", () => {
    expect(resolveModelForAgent("claude", "claude-2")).toBe(
      getDefaultModelForAgent("claude")
    );
  });

  it("offers Claude's family aliases, which track the newest model", () => {
    const values = getModelOptions("claude").map((o) => o.value);
    expect(values).toEqual(
      expect.arrayContaining(["fable", "opus", "sonnet", "haiku"])
    );
  });
});

describe("modelDisplayName", () => {
  it("names full ids, aliases and passes unknown ids through", async () => {
    const { modelDisplayName } = await import("./model-catalog");
    expect(modelDisplayName("claude-opus-5-5")).toBe("Opus 5.5");
    expect(modelDisplayName("claude-haiku-4-5-20251001")).toBe("Haiku 4.5");
    expect(modelDisplayName("opus")).toBe("Opus");
    expect(modelDisplayName("gpt-9")).toBe("gpt-9");
  });
});

describe("discoversModels", () => {
  it("is true for chat agents without a fixed list only", async () => {
    const { discoversModels } = await import("./model-catalog");
    expect(discoversModels("opencode")).toBe(true);
    expect(discoversModels("claude")).toBe(false);
    expect(discoversModels("aider")).toBe(false);
  });
});
