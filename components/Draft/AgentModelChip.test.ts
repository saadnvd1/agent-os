import { describe, expect, it } from "vitest";
import type { CatalogAgent, MachineCatalog } from "@/lib/machines/types";
import { catalogBlocker, usableAgent } from "./AgentModelChip";

const agent = (over: Partial<CatalogAgent>): CatalogAgent => ({
  agent: "claude",
  label: "Claude Code",
  installed: true,
  auth: "ready",
  hint: null,
  models: [],
  defaultModel: "opus",
  taskBlocked: null,
  modelsError: null,
  ...over,
});

describe("usableAgent", () => {
  const catalog: MachineCatalog = {
    agents: [
      agent({ agent: "codex", installed: false }),
      agent({ agent: "opencode", defaultModel: "default" }),
      agent({ agent: "claude", auth: "needs-login" }),
    ],
    ollama: [],
    recent: [],
  };

  it("keeps an agent the machine can run", () => {
    expect(usableAgent(catalog, "opencode")).toBeNull();
  });

  it("moves to the first agent that is installed and signed in", () => {
    expect(usableAgent(catalog, "codex")?.agent).toBe("opencode");
    expect(usableAgent(catalog, "claude")?.agent).toBe("opencode");
    expect(usableAgent(catalog, "aider")?.agent).toBe("opencode");
  });

  it("names what blocks an agent", () => {
    expect(catalogBlocker(catalog.agents[0])).toBe("Not installed");
    expect(catalogBlocker(catalog.agents[2])).toBe("Needs sign-in");
    expect(catalogBlocker(catalog.agents[1])).toBeNull();
  });
});
