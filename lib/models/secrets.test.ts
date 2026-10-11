import fs from "fs";
import { randomUUID } from "crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../db";
import { ensureOrchestrator } from "../orchestrator/home";
import { seedSession, seedWorkspace } from "../orchestrator/testing";
import { recordTurn } from "../usage/turns";
import { setModelSettings } from "./config";
import {
  routedRun,
  routeOrchestrator,
  sessionProviderEnv,
  sessionShellEnv,
} from "./launch";
import { PROVIDER_PRESETS } from "./providers";
import { redact, resolveSecret, secretCommand } from "./secrets";
import { testProvider } from "./test-provider";

// Built at runtime: no key-shaped text lives in the repository.
const KEY = ["fake", randomUUID(), randomUUID()].join("-");

const calls: string[][] = [];
const exec = async (cmd: string, args: string[]) => {
  calls.push([cmd, ...args]);
  if (cmd === "security" && args.includes("deepseek-api")) return `${KEY}\n`;
  if (cmd === "tv" && args[1] === "zai") return `${KEY}\n`;
  throw new Error("not found");
};

const deepseek = {
  ...PROVIDER_PRESETS.find((p) => p.id === "deepseek")!,
  auth: { kind: "keychain" as const, service: "deepseek-api" },
  enabled: true,
};
const zai = {
  ...PROVIDER_PRESETS.find((p) => p.id === "zai")!,
  auth: { kind: "tokenvault" as const, project: "zai", desc: "api key" },
  enabled: true,
};

let logged = "";
beforeEach(() => {
  calls.length = 0;
  logged = "";
  for (const level of ["log", "info", "warn", "error", "debug"] as const)
    vi.spyOn(console, level).mockImplementation((...args) => {
      logged += `${args.map(String).join(" ")}\n`;
    });
  setModelSettings({
    providers: [deepseek, zai],
    roles: { implement: "deepseek/deepseek-v4-pro" },
  });
});
afterEach(() => vi.restoreAllMocks());

describe("secret references", () => {
  it("reads a key with the reference's own command, never a shell", async () => {
    expect(secretCommand(zai.auth)).toEqual(["tv", "get", "zai", "api key"]);
    expect(secretCommand(deepseek.auth)).toEqual([
      "security",
      "find-generic-password",
      "-s",
      "deepseek-api",
      "-w",
    ]);
    expect(await resolveSecret(zai.auth, exec)).toBe(KEY);
    await expect(
      resolveSecret({ kind: "keychain", service: "missing" }, exec)
    ).rejects.toThrow("Couldn't read the key (security failed)");
  });

  it("won't read an env reference that isn't an API key's", async () => {
    vi.stubEnv("DEEPSEEK_API_KEY", KEY);
    expect(
      await resolveSecret({ kind: "env", name: "DEEPSEEK_API_KEY" }, exec)
    ).toBe(KEY);
    for (const name of ["HOME", "ANTHROPIC_API_KEY", "AGENTOS_X_API_KEY"])
      await expect(resolveSecret({ kind: "env", name }, exec)).rejects.toThrow(
        /_API_KEY/
      );
    vi.unstubAllEnvs();
  });

  it("falls back to the default model when a provider can't be used", async () => {
    // A helper run whose key can't be read still runs, on Claude.
    const broken = async () => {
      throw new Error("not found");
    };
    setModelSettings({
      providers: [deepseek, zai],
      roles: { helper: "deepseek/deepseek-flash", orchestrator: "zai/glm-5.3" },
    });
    expect(await routedRun("helper", {}, broken)).toEqual({
      model: "claude-haiku-4-5-20251001",
      provider: "anthropic",
      env: {},
    });

    const { workspace } = seedWorkspace();
    const row = ensureOrchestrator(workspace.id);
    // Its key won't come: the orchestrator starts on its default.
    expect(await routeOrchestrator(row, broken)).toMatchObject({
      model: "claude-opus-5-5",
      model_provider: null,
    });
    // Its key comes: it runs where it's routed.
    expect(await routeOrchestrator(row, exec)).toMatchObject({
      model: "glm-5.3",
      model_provider: "zai",
    });
    // Its provider turned off: the default again, and the row says so.
    setModelSettings({
      providers: [deepseek, { ...zai, enabled: false }],
      roles: { orchestrator: "zai/glm-5.3" },
    });
    await routeOrchestrator(row, exec);
    expect(
      db
        .prepare(`SELECT model, model_provider FROM sessions WHERE id = ?`)
        .get(row.id)
    ).toEqual({ model: "claude-opus-5-5", model_provider: null });
  });

  it("puts the key in the agent's environment as its provider wants it", async () => {
    const env = await sessionProviderEnv(
      { model: "deepseek-v4-pro", model_provider: "deepseek" },
      exec
    );
    expect(env).toMatchObject({
      ANTHROPIC_BASE_URL: "https://api.deepseek.com/anthropic",
      ANTHROPIC_API_KEY: KEY,
      // The other variable emptied, so AgentOS's own never reaches it.
      ANTHROPIC_AUTH_TOKEN: "",
      ANTHROPIC_DEFAULT_OPUS_MODEL: "deepseek-v4-pro",
      ANTHROPIC_DEFAULT_SONNET_MODEL: "deepseek-flash",
      ANTHROPIC_DEFAULT_HAIKU_MODEL: "deepseek-flash",
    });
    const glm = await routedRun(
      "implement",
      { override: { implement: "zai/glm-5.3" } },
      exec
    );
    expect(glm.env).toMatchObject({
      ANTHROPIC_AUTH_TOKEN: KEY,
      ANTHROPIC_API_KEY: "",
      API_TIMEOUT_MS: "3000000",
    });
    expect(
      await sessionProviderEnv({ model: "opus", model_provider: null }, exec)
    ).toBeNull();
  });

  it("gives a terminal launch the reference, not the key", () => {
    const { env, exportKey } = sessionShellEnv({
      model: "deepseek-v4-pro",
      model_provider: "deepseek",
    });
    expect(exportKey).toBe(
      `export ANTHROPIC_API_KEY="$('security' 'find-generic-password' '-s' 'deepseek-api' '-w')";`
    );
    expect(JSON.stringify(env)).not.toContain(KEY);
  });

  it("never writes a key to the database or a log", async () => {
    const { app } = seedWorkspace();
    const task = seedSession({ projectId: app.id, name: "routed", task: true });
    db.prepare(
      `UPDATE sessions SET model = 'deepseek-v4-pro', model_provider = 'deepseek' WHERE id = ?`
    ).run(task);

    // Everything that handles the key: a launch, a run, a test whose
    // endpoint echoes it back, a turn recorded, and an error about it.
    await sessionProviderEnv(
      { model: "deepseek-v4-pro", model_provider: "deepseek" },
      exec
    );
    await routedRun("implement", {}, exec);
    const echo = vi.fn(
      async (_url: string, init: RequestInit) =>
        new Response(`bad key ${JSON.stringify(init.headers)}`, {
          status: 401,
        })
    );
    const tested = await testProvider("deepseek", undefined, {
      exec,
      fetch: echo as unknown as typeof fetch,
    });
    expect(echo).toHaveBeenCalledOnce();
    expect(tested.ok).toBe(false);
    expect(tested.message).toContain("[redacted]");
    expect(tested.message).not.toContain(KEY);

    // A redirect isn't followed (it would carry the key elsewhere), and an
    // endpoint's text can't put control characters in front of anyone.
    const moved = await testProvider("deepseek", undefined, {
      exec,
      fetch: (async () =>
        new Response(null, {
          status: 307,
          headers: { location: "https://elsewhere.example/" },
        })) as unknown as typeof fetch,
    });
    expect(moved).toMatchObject({ ok: false });
    expect(moved.message).toMatch(/redirected/);
    const init = echo.mock.calls[0][1];
    expect(init.redirect).toBe("manual");
    const noisy = await testProvider("deepseek", undefined, {
      exec,
      fetch: (async () =>
        new Response("bad\u001b[2Jkey", {
          status: 400,
        })) as unknown as typeof fetch,
    });
    expect(noisy.message).toBe("HTTP 400: bad [2Jkey");
    recordTurn(
      { id: task, name: "routed", workspace_id: null },
      null,
      {
        costUsd: 0.01,
        inputTokens: 10,
        outputTokens: 5,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      },
      Date.now(),
      1000,
      () => null
    );
    console.error(redact(`launch failed with ${KEY}`));

    db.pragma("wal_checkpoint(TRUNCATE)");
    const files = [process.env.DB_PATH!, `${process.env.DB_PATH}-wal`].filter(
      (f) => fs.existsSync(f)
    );
    for (const f of files)
      expect(fs.readFileSync(f).includes(KEY), f).toBe(false);
    const saved = db
      .prepare(`SELECT value FROM settings WHERE key = 'models'`)
      .get() as { value: string };
    expect(saved.value).toContain("deepseek-api");
    expect(logged).toContain("[redacted]");
    expect(logged).not.toContain(KEY);
  });
});
