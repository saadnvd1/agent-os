import { describe, expect, it } from "vitest";
import { analystBlock, defaultAnalystLabel } from "./usable";

const ok = {
  toolUse: true,
  agent: "claude" as const,
  availability: { state: "up" as const, checkedAt: null },
};

describe("analystBlock", () => {
  it("lets a usable, tool-capable model through", () => {
    expect(analystBlock(ok)).toBeNull();
  });

  it("says why a model is out", () => {
    expect(analystBlock({ ...ok, unusable: "Provider is off" })).toBe(
      "Provider is off"
    );
    expect(analystBlock({ ...ok, toolUse: false })).toBe("Can't call tools");
    expect(
      analystBlock({
        ...ok,
        availability: { state: "down", checkedAt: null, error: "ECONNREFUSED" },
      })
    ).toBe("Not answering (ECONNREFUSED)");
  });

  it("blocks the other agent when a running session can't change", () => {
    expect(analystBlock({ ...ok, agent: "pi" }, { agent: "claude" })).toMatch(
      /Pi/
    );
    expect(analystBlock(ok, { agent: "claude" })).toBeNull();
  });
});

describe("defaultAnalystLabel", () => {
  it("names the default model", () => {
    expect(defaultAnalystLabel("anthropic/claude-opus-5-5", [])).toBe(
      "Default analyst model (Opus 5.5)"
    );
    expect(
      defaultAnalystLabel("ollama/qwen3.8", [
        { ref: "ollama/qwen3.8", label: "Qwen 3.8 27B" },
      ])
    ).toBe("Default analyst model (Qwen 3.8 27B)");
    expect(defaultAnalystLabel(null, [])).toBe("Default analyst model (…)");
  });
});
