import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../db";
import {
  seedOrchestrator,
  seedSession,
  seedWorkspace,
} from "../orchestrator/testing";
import {
  setModelSettings,
  setProjectModels,
  setWorkspaceModels,
} from "./config";
import { PROVIDER_PRESETS } from "./providers";
import { parseOverride, providerShellEnv, resolveRole } from "./resolve";
import { DEFAULT_ROLE_MODELS, parseModelRef } from "./roles";
import { sessionRole } from "./session-role";

const deepseek = {
  ...PROVIDER_PRESETS.find((p) => p.id === "deepseek")!,
  auth: { kind: "keychain" as const, service: "deepseek-api" },
  enabled: true,
};

beforeEach(() => {
  db.prepare(`DELETE FROM settings WHERE key LIKE 'models%'`).run();
});
afterEach(() => vi.unstubAllEnvs());

describe("role resolution", () => {
  it("runs every role on Claude by default", () => {
    for (const [role, ref] of Object.entries(DEFAULT_ROLE_MODELS)) {
      const r = resolveRole(role as keyof typeof DEFAULT_ROLE_MODELS);
      expect(r.ref).toBe(ref);
      expect(r.provider.id).toBe("anthropic");
      // The reviewer's advice follows the gate until it's set.
      expect(r.source).toBe(role === "advise" ? "inherited" : "default");
    }
    expect(resolveRole("plan").model).toBe("claude-opus-5-5");
    expect(resolveRole("implement").model).toBe("claude-sonnet-5-5");
    expect(resolveRole("helper").model).toBe("claude-haiku-4-5-20251001");
  });

  it("takes Settings over the default, the workspace over Settings, and the task over both", () => {
    const { workspace } = seedWorkspace();
    setModelSettings({
      roles: { implement: "anthropic/claude-opus-5-5" },
      providers: [deepseek],
    });
    expect(resolveRole("implement")).toMatchObject({
      model: "claude-opus-5-5",
      source: "settings",
    });

    setWorkspaceModels(workspace.id, {
      roles: { implement: "deepseek/deepseek-v4-pro" },
    });
    const ws = resolveRole("implement", { workspaceId: workspace.id });
    expect(ws).toMatchObject({ model: "deepseek-v4-pro", source: "workspace" });
    expect(ws.provider.id).toBe("deepseek");
    // Another workspace still follows Settings.
    expect(resolveRole("implement", { workspaceId: "other" }).source).toBe(
      "settings"
    );

    const one = parseOverride("anthropic/claude-sonnet-5-5");
    expect(
      resolveRole("implement", { workspaceId: workspace.id, override: one })
    ).toMatchObject({ model: "claude-sonnet-5-5", source: "task" });
    // A map overrides only the roles it names.
    const map = parseOverride({ plan: "deepseek/deepseek-flash" });
    expect(
      resolveRole("plan", { workspaceId: workspace.id, override: map })
    ).toMatchObject({ model: "deepseek-flash", source: "task" });
    expect(
      resolveRole("implement", { workspaceId: workspace.id, override: map })
        .source
    ).toBe("workspace");
  });

  it("never lets a task pick the model that gates it", () => {
    setModelSettings({ providers: [deepseek] });
    expect(() => parseOverride({ review: "deepseek/deepseek-flash" })).toThrow(
      /can't pick its own review model/
    );
    expect(() => parseOverride({ scope: "deepseek/deepseek-flash" })).toThrow(
      /scope/
    );
    // One model for the task covers its own roles, not its review.
    const one = parseOverride("deepseek/deepseek-flash");
    expect(resolveRole("implement", { override: one }).model).toBe(
      "deepseek-flash"
    );
    expect(resolveRole("review", { override: one })).toMatchObject({
      model: "claude-opus-5-5",
      source: "default",
    });
    expect(resolveRole("scope", { override: one }).source).toBe("default");
  });

  it("refuses a provider that's off, unknown or keyless", () => {
    expect(() => parseOverride("deepseek/deepseek-v4-pro")).toThrow(/off/);
    expect(() => parseOverride("nowhere/model-x")).toThrow(/No model provider/);
    setModelSettings({ providers: [{ ...deepseek, auth: undefined }] });
    expect(() => parseOverride("deepseek/deepseek-v4-pro")).toThrow(
      /base URL and a key/
    );
  });

  it("still reads AGENTOS_REVIEW_MODEL and AGENTOS_TITLE_MODEL, under Settings", () => {
    vi.stubEnv("AGENTOS_REVIEW_MODEL", "sonnet");
    vi.stubEnv("AGENTOS_TITLE_MODEL", "claude-haiku-4-5");
    expect(resolveRole("review")).toMatchObject({
      model: "sonnet",
      source: "env",
    });
    expect(resolveRole("scope").model).toBe("sonnet");
    expect(resolveRole("helper")).toMatchObject({
      model: "claude-haiku-4-5",
      provider: { id: "anthropic" },
    });
    expect(resolveRole("implement").source).toBe("default");
    setModelSettings({ roles: { review: "anthropic/claude-opus-5-5" } });
    expect(resolveRole("review").model).toBe("claude-opus-5-5");
  });

  it("reads a bare model as Anthropic's", () => {
    expect(parseModelRef("opus")).toEqual({
      provider: "anthropic",
      model: "opus",
    });
    expect(parseOverride("sonnet")).toBe("anthropic/sonnet");
    expect(parseModelRef("or/anthropic/claude-x")).toEqual({
      provider: "or",
      model: "anthropic/claude-x",
    });
  });

  it("names the role a session's next turn runs as", () => {
    expect(sessionRole({ role: "orchestrator" })).toBe("orchestrator");
    expect(sessionRole({})).toBe("interactive");
    // Work an orchestrator started is implementation; Saad's own is not.
    seedOrchestrator("orch-1");
    expect(sessionRole({ started_by: "orch-1" })).toBe("implement");
    // A plain task's own spawn is not orchestrator work.
    const { app } = seedWorkspace();
    expect(
      sessionRole({
        started_by: seedSession({ projectId: app.id, name: "t", task: true }),
      })
    ).toBe("interactive");
    expect(sessionRole({ started_by: null })).toBe("interactive");
    expect(
      sessionRole({ task_status: "running", plan_phase: "planning" })
    ).toBe("plan");
    expect(sessionRole({ task_status: "running" })).toBe("implement");
  });
});

describe("model settings", () => {
  it("tells Claude Code a provider's context window", () => {
    const env = (window?: number) =>
      providerShellEnv(
        { ...deepseek, contextWindow: window } as typeof deepseek,
        "deepseek-v4-pro"
      ).env;
    expect(env(1_000_000).CLAUDE_CODE_MAX_CONTEXT_TOKENS).toBe("1000000");
    expect(env()).not.toHaveProperty("CLAUDE_CODE_MAX_CONTEXT_TOKENS");
    for (const bad of [50_000, 1.5, "1000000"])
      expect(() =>
        setModelSettings({ providers: [{ ...deepseek, contextWindow: bad }] })
      ).toThrow(/contextWindow/);
    expect(() =>
      setModelSettings({
        providers: [{ ...deepseek, contextWindow: 1_000_000 }],
      })
    ).not.toThrow();
  });

  it("rejects what could carry a key or reach a shell", () => {
    expect(() =>
      setModelSettings({
        providers: [{ ...deepseek, env: { ANTHROPIC_AUTH_TOKEN: "x" } }],
      })
    ).toThrow(/providers\.0\.env/);
    expect(() =>
      setModelSettings({
        providers: [
          { ...deepseek, auth: { kind: "tokenvault", project: "-rf" } },
        ],
      })
    ).toThrow(/can't start with -/);
    expect(() =>
      setModelSettings({
        providers: [
          {
            ...deepseek,
            auth: { kind: "keychain", service: "a$(touch x)" },
          },
        ],
      })
    ).toThrow();
    expect(() =>
      setModelSettings({
        providers: [{ ...deepseek, baseUrl: "http://example.com" }],
      })
    ).toThrow(/https/);
    expect(() =>
      setModelSettings({ roles: { implement: "not a ref" } })
    ).toThrow(/provider\/model/);
    // An env reference names an API key, never the server's own secrets.
    for (const name of [
      "HOME",
      "ANTHROPIC_API_KEY",
      "CLAUDE_CODE_OAUTH_TOKEN",
      "AGENTOS_DEVICE_API_KEY",
      "GITHUB_TOKEN",
    ])
      expect(() =>
        setModelSettings({
          providers: [{ ...deepseek, auth: { kind: "env", name } }],
        })
      ).toThrow(/_API_KEY/);
    setModelSettings({
      providers: [
        { ...deepseek, auth: { kind: "env", name: "DEEPSEEK_API_KEY" } },
      ],
    });
  });

  it("keeps the Claude login as anthropic", () => {
    expect(() =>
      setModelSettings({
        providers: [
          {
            ...PROVIDER_PRESETS[0],
            baseUrl: "https://example.com",
          },
        ],
      })
    ).toThrow(/Claude login/);
  });
});

describe("agent role bindings", () => {
  it("takes a project's model over the workspace's and under the task's", () => {
    const { workspace } = seedWorkspace();
    setModelSettings({ providers: [deepseek] });
    setWorkspaceModels(workspace.id, {
      roles: { analyze: "anthropic/claude-sonnet-5-5" },
    });
    setProjectModels("proj-1", {
      roles: { analyze: "deepseek/deepseek-v4-pro" },
    });
    expect(
      resolveRole("analyze", { workspaceId: workspace.id, projectId: "proj-1" })
    ).toMatchObject({ model: "deepseek-v4-pro", source: "project" });
    expect(
      resolveRole("analyze", { workspaceId: workspace.id, projectId: "other" })
    ).toMatchObject({ model: "claude-sonnet-5-5", source: "workspace" });
    expect(
      resolveRole("analyze", {
        workspaceId: workspace.id,
        projectId: "proj-1",
        override: "anthropic/claude-opus-5-5",
      }).source
    ).toBe("task");
  });

  it("has the reviewer follow the gate's model until it is set", () => {
    setModelSettings({ roles: { review: "anthropic/claude-sonnet-5-5" } });
    expect(resolveRole("advise")).toMatchObject({
      model: "claude-sonnet-5-5",
      source: "inherited",
    });
    setModelSettings({
      roles: {
        review: "anthropic/claude-sonnet-5-5",
        advise: "anthropic/claude-opus-5-5",
      },
    });
    expect(resolveRole("advise")).toMatchObject({
      model: "claude-opus-5-5",
      source: "settings",
    });
  });

  it("runs a Pi model only for a role session, never a task or a gate", () => {
    setModelSettings({ roles: { implement: "pi/local/qwen3-27b" } });
    expect(() => resolveRole("implement")).toThrow(/role/);
    const r = resolveRole("implement", { allowPi: true });
    expect(r).toMatchObject({ ref: "pi/local/qwen3-27b", source: "settings" });
    expect(r.provider.id).toBe("pi");
  });
});
