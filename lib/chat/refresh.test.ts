import { describe, expect, it } from "vitest";
import type { Session } from "../db";
import { db } from "../db";
import { agentEnv } from "../agents/launch";
import { seedSession, seedWorkspace } from "../orchestrator/testing";
import {
  AUTO_COMPACT_ENV,
  PROVIDER_BASE_TOKENS,
  compactThreshold,
  refreshSettings,
  setRefreshSettings,
} from "./refresh";
import { roleExtras } from "./worker/extras";
import { parseFreshStart } from "@/components/Workspaces/fresh-start";

const task = (over: Partial<Session> = {}) =>
  ({
    role: null,
    task_brief: "Build the thing",
    task_status: "running",
    ...over,
  }) as Session;

describe("fresh-start settings", () => {
  it("are on at 200k for orchestrators and off for tasks by default", async () => {
    expect(refreshSettings()).toEqual({
      orchestratorTokens: 200_000,
      taskTokens: 0,
      compactTokens: 150_000,
      autoCompactTokens: 300_000,
    });
    expect((await roleExtras(task())).refresh).toBeUndefined();
  });

  it("give a running task's chat its threshold once switched on", async () => {
    setRefreshSettings({ taskTokens: 150_000 });
    try {
      expect((await roleExtras(task())).refresh).toEqual({
        atTokens: 150_000,
        role: "task",
      });
      expect(
        (await roleExtras(task({ task_status: "merged" }))).refresh
      ).toBeUndefined();
    } finally {
      setRefreshSettings({ taskTokens: 0 });
    }
  });

  it("refuse a threshold out of range, saving nothing", () => {
    for (const bad of [10_000, 1_000_000, 150_000.5, "200000", -1])
      expect(() =>
        setRefreshSettings({
          orchestratorTokens: 300_000,
          taskTokens: bad as number,
        })
      ).toThrow(/off or between 50k and 900k/);
    expect(refreshSettings().orchestratorTokens).toBe(200_000);
    setRefreshSettings({ orchestratorTokens: 0 });
    expect(refreshSettings().orchestratorTokens).toBe(0);
    setRefreshSettings({ orchestratorTokens: 200_000 });
  });

  it("save the stale-compact threshold, 0 for off, in the same range", () => {
    setRefreshSettings({ compactTokens: 0 });
    expect(refreshSettings().compactTokens).toBe(0);
    expect(() => setRefreshSettings({ compactTokens: 10_000 })).toThrow(
      /off or between/
    );
    setRefreshSettings({ compactTokens: 150_000 });
    expect(refreshSettings().compactTokens).toBe(150_000);
  });

  it("are typed in thousands in Settings", () => {
    expect(parseFreshStart(true, "200")).toEqual({ tokens: 200_000 });
    expect(parseFreshStart(false, "nope")).toEqual({ tokens: 0 });
    expect(parseFreshStart(true, "20")).toHaveProperty("error");
    expect(parseFreshStart(true, "")).toHaveProperty("error");
  });
});

describe("the compact threshold at launch", () => {
  it("sets Claude Code's own auto-compact window for chats and tasks, never an orchestrator", () => {
    const ws = seedWorkspace();
    const chat = seedSession({ projectId: ws.app.id, name: "c", view: "chat" });
    const task = seedSession({ projectId: ws.app.id, name: "t", task: true });
    const orch = seedSession({ projectId: ws.app.id, name: "o", view: "chat" });
    db.prepare(`UPDATE sessions SET role = 'orchestrator' WHERE id = ?`).run(
      orch
    );
    expect(agentEnv(chat)[AUTO_COMPACT_ENV]).toBe("300000");
    expect(agentEnv(task)[AUTO_COMPACT_ENV]).toBe("300000");
    expect(agentEnv(orch)[AUTO_COMPACT_ENV]).toBeUndefined();
    // A non-Anthropic provider's prompt carries every tool schema, so its
    // window sits that much higher.
    db.prepare(
      `UPDATE sessions SET model_provider = 'deepseek' WHERE id = ?`
    ).run(task);
    expect(agentEnv(task)[AUTO_COMPACT_ENV]).toBe(
      String(300_000 + PROVIDER_BASE_TOKENS)
    );
    expect(compactThreshold(0, "deepseek")).toBe(0);
    // Capped at the provider's window.
    expect(compactThreshold(990_000, "deepseek")).toBe(1_000_000);
    expect(compactThreshold(150_000, null)).toBe(150_000);
    // A provider with no stated window is not capped.
    expect(compactThreshold(150_000, "no-such-provider")).toBe(
      150_000 + PROVIDER_BASE_TOKENS
    );
    try {
      // Under Claude Code's 100k floor, it gets the floor; off sets nothing.
      setRefreshSettings({ autoCompactTokens: 60_000 });
      expect(agentEnv(chat)[AUTO_COMPACT_ENV]).toBe("100000");
      setRefreshSettings({ autoCompactTokens: 0 });
      expect(agentEnv(chat)[AUTO_COMPACT_ENV]).toBeUndefined();
      // The between-turn threshold is a separate setting.
      setRefreshSettings({ autoCompactTokens: 300_000, compactTokens: 0 });
      expect(agentEnv(chat)[AUTO_COMPACT_ENV]).toBe("300000");
    } finally {
      setRefreshSettings({
        autoCompactTokens: 300_000,
        compactTokens: 150_000,
      });
    }
  });
});

describe("MCP servers for a routed terminal agent", () => {
  it("are none but AgentOS's, and nothing changes on Claude", async () => {
    const { routedMcpFlags } = await import("../agents/launch");
    expect(routedMcpFlags(null)).toBe("");
    expect(routedMcpFlags(undefined)).toBe("");
    expect(routedMcpFlags("deepseek")).toBe("--strict-mcp-config ");
  });
});
