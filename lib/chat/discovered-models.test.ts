import { beforeEach, describe, expect, it, vi } from "vitest";

const discover = vi.hoisted(() => vi.fn());
vi.mock("./drivers", () => ({
  chatDriverFor: (agent: string) =>
    agent === "opencode" ? { discover } : null,
}));

import {
  clearDiscoveredModels,
  discoveredModels,
  isDiscoveredModel,
} from "./discovered-models";

const qwen = { value: "ollama/qwen3", label: "Qwen 3" };

beforeEach(() => {
  clearDiscoveredModels();
  discover.mockReset();
  discover.mockResolvedValue({ commands: [], models: [qwen] });
});

describe("discoveredModels", () => {
  it("asks the driver once per folder and caches, until refreshed", async () => {
    expect(await discoveredModels("opencode", "/w")).toEqual([qwen]);
    await discoveredModels("opencode", "/w");
    expect(discover).toHaveBeenCalledTimes(1);
    await discoveredModels("opencode", "/w", true);
    expect(discover).toHaveBeenCalledTimes(2);
  });

  it("shares one discovery between concurrent callers", async () => {
    await Promise.all([
      discoveredModels("opencode", "/w"),
      discoveredModels("opencode", "/w"),
    ]);
    expect(discover).toHaveBeenCalledTimes(1);
  });

  it("is empty for an agent with a fixed list, without asking", async () => {
    expect(await discoveredModels("claude", "/w")).toEqual([]);
    expect(discover).not.toHaveBeenCalled();
  });

  it("does not cache a failure", async () => {
    discover.mockRejectedValueOnce(new Error("no server"));
    await expect(discoveredModels("opencode", "/w")).rejects.toThrow();
    expect(await discoveredModels("opencode", "/w")).toEqual([qwen]);
  });

  it("knows a reported model, and not an unknown one or after a failure", async () => {
    expect(await isDiscoveredModel("opencode", "/w", qwen.value)).toBe(true);
    expect(await isDiscoveredModel("opencode", "/w", "x/y")).toBe(false);
    clearDiscoveredModels();
    discover.mockRejectedValue(new Error("down"));
    expect(await isDiscoveredModel("opencode", "/w", qwen.value)).toBe(false);
  });
});
