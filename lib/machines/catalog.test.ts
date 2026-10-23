import { beforeEach, describe, expect, it, vi } from "vitest";

const probes = vi.hoisted(() => ({
  value: {} as Record<string, unknown>,
}));
const found = vi.hoisted(() => ({
  value: {} as Record<string, { value: string; label: string }[]>,
  fail: new Set<string>(),
}));
const tags = vi.hoisted(() => ({ value: [] as string[] }));

vi.mock("../agents/probe", () => ({
  probeAgents: async () => probes.value,
}));
vi.mock("../chat/discovered-models", () => ({
  discoveredModels: async (agent: string) => {
    if (found.fail.has(agent)) throw new Error("no server");
    return found.value[agent] ?? [];
  },
}));
vi.mock("./ollama", () => ({ ollamaModels: async () => tags.value }));

import { machineCatalog, ollamaRunner } from "./catalog";

beforeEach(() => {
  probes.value = {
    claude: { installed: true, auth: "ready" },
    opencode: { installed: true, auth: "ready" },
    codex: { installed: false, auth: "unknown", hint: "npm i -g codex" },
  };
  found.value = {};
  found.fail = new Set();
  tags.value = [];
});

describe("machineCatalog", () => {
  it("groups models by agent and keeps uninstalled agents, flagged", async () => {
    found.value.opencode = [{ value: "ollama/qwen3:27b", label: "Qwen" }];
    const { agents } = await machineCatalog();
    const claude = agents.find((a) => a.agent === "claude")!;
    expect(claude.models.map((m) => m.value)).toContain("opus");
    expect(claude.taskBlocked).toBeNull();
    const oc = agents.find((a) => a.agent === "opencode")!;
    expect(oc.models.map((m) => m.value)).toEqual([
      "default",
      "ollama/qwen3:27b",
    ]);
    expect(oc.taskBlocked).toMatch(/Claude Code only/);
    const codex = agents.find((a) => a.agent === "codex")!;
    expect(codex).toMatchObject({ installed: false, hint: "npm i -g codex" });
  });

  it("keeps the fixed list and says why when discovery fails", async () => {
    found.fail.add("opencode");
    const oc = (await machineCatalog()).agents.find(
      (a) => a.agent === "opencode"
    )!;
    expect(oc.models.map((m) => m.value)).toEqual(["default"]);
    expect(oc.modelsError).toBe("no server");
  });

  it("maps an Ollama model to the agent that lists it", async () => {
    tags.value = ["qwen3:27b", "mystery:1b"];
    found.value.opencode = [{ value: "ollama/qwen3:27b", label: "Qwen" }];
    const { ollama } = await machineCatalog();
    expect(ollama).toEqual([
      {
        name: "qwen3:27b",
        runsWith: { agent: "opencode", model: "ollama/qwen3:27b" },
      },
      { name: "mystery:1b", runsWith: null },
    ]);
  });
});

describe("ollamaRunner", () => {
  it("prefers OpenCode, then Pi, and matches an Ollama provider by tag", () => {
    const both = {
      opencode: [{ value: "ollama/x:1", label: "x" }],
      pi: [{ value: "local/x:1", label: "x", description: "ollama" }],
    };
    expect(ollamaRunner("x:1", both)?.agent).toBe("opencode");
    expect(ollamaRunner("x:1", { pi: both.pi })).toEqual({
      agent: "pi",
      model: "local/x:1",
    });
    expect(
      ollamaRunner("x:1", { pi: [{ value: "openai/x:1", label: "x" }] })
    ).toBeNull();
  });
});
