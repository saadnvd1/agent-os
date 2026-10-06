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
