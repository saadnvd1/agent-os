import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  createWorkspace,
  getWorkspace,
  updateWorkspace,
} from "@/lib/workspaces";
import { ensureOrchestrator } from "./home";
import { orchestratorExtras } from "./worker";
import { orchestratorBrief } from "./brief";
import {
  DEFAULT_MCP_SERVERS,
  configuredMcpServers,
  orchestratorPermissions,
} from "./mcp-servers";
import { ORCHESTRATOR_PERMISSIONS } from "./tool-names";
import { GET } from "@/app/api/mcp-servers/route";

let home: string;
beforeAll(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "aos-mcp-"));
  vi.spyOn(os, "homedir").mockReturnValue(home);
});
afterEach(() => vi.unstubAllEnvs());

describe("an orchestrator's MCP permissions", () => {
  it("add one bare rule per allowed server and nothing else", () => {
    const p = orchestratorPermissions(["linear", "plugin:slack:slack", " "]);
    expect(p.allowedTools).toEqual([
      ...ORCHESTRATOR_PERMISSIONS.allowedTools,
      "mcp__linear",
      "mcp__plugin_slack_slack",
    ]);
    expect(p.permissionMode).toBe("dontAsk");
    expect(p.disallowedTools).toEqual(ORCHESTRATOR_PERMISSIONS.disallowedTools);
  });

  it("allow no MCP server when none is named", () => {
    expect(orchestratorPermissions([]).allowedTools).toEqual(
      ORCHESTRATOR_PERMISSIONS.allowedTools
    );
  });

  it("default to linear for a new workspace, and reach the worker", async () => {
    expect(DEFAULT_MCP_SERVERS).toEqual(["linear"]);
    const w = createWorkspace("Mcp");
    expect(getWorkspace(w.id)!.orch_mcp_servers).toEqual(["linear"]);
    const session = ensureOrchestrator(w.id);
    expect((await orchestratorExtras(session)).allowedTools).toContain(
      "mcp__linear"
    );
    updateWorkspace(w.id, { mcpServers: [] });
    expect((await orchestratorExtras(session)).allowedTools).not.toContain(
      "mcp__linear"
    );
  });

  it("are rejected unless a list of names", () => {
    const w = createWorkspace("Bad");
    expect(() =>
      updateWorkspace(w.id, { mcpServers: "linear" as unknown as string[] })
    ).toThrow();
  });

  it("are explained in the brief, with outbound actions as hard lines", () => {
    const brief = orchestratorBrief({ workspace: "W", projects: [] });
    expect(brief).toMatch(/MCP servers this workspace allows/);
    expect(brief).toMatch(/Anything outbound through them/);
  });
});

describe("the configured server list", () => {
  it("is names only, never env, headers or tokens", async () => {
    fs.writeFileSync(
      path.join(home, ".claude.json"),
      JSON.stringify({
        mcpServers: {
          linear: { type: "http", url: "https://x", headers: { a: "SECRET1" } },
          other: { command: "x", env: { TOKEN: "SECRET2" } },
        },
        claudeAiMcpEverConnected: ["claude.ai Gmail"],
      })
    );
    const names = configuredMcpServers();
    expect(names).toEqual(["claude.ai Gmail", "linear", "other"]);
    const body = JSON.stringify(await (await GET()).json());
    expect(body).not.toMatch(/SECRET|https:\/\/x|TOKEN/);
  });

  it("includes installed plugins' servers", () => {
    const dir = path.join(home, "plug");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, ".mcp.json"),
      JSON.stringify({ slack: { type: "http", url: "https://s" } })
    );
    fs.mkdirSync(path.join(home, ".claude", "plugins"), { recursive: true });
    fs.writeFileSync(
      path.join(home, ".claude", "plugins", "installed_plugins.json"),
      JSON.stringify({ plugins: { "slack@m": [{ installPath: dir }] } })
    );
    expect(configuredMcpServers()).toContain("plugin:slack:slack");
  });
});
