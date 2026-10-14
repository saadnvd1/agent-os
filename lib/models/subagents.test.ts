import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../db";
import { setModelSettings } from "./config";
import { providerShellEnv } from "./resolve";
import { PROVIDER_PRESETS } from "./providers";
import { DEFAULT_SUBAGENT_MODELS } from "./subagent-tiers";
import {
  effectiveSubagentModels,
  parseSubagentEnv,
  routeAgentInput,
  subagentEnv,
  subagentModelHook,
  tierFor,
} from "./subagents";

const MAP = DEFAULT_SUBAGENT_MODELS;
const route = (subagent_type: string, extra: object = {}) =>
  routeAgentInput({ subagent_type, prompt: "p", ...extra }, MAP);

beforeEach(() => {
  db.prepare(`DELETE FROM settings WHERE key LIKE 'models%'`).run();
});

describe("tierFor", () => {
  it("takes an exact entry over a prefix, and the longest prefix", () => {
    const map = { "review-*": "sonnet", "review-fast": "opus", "re*": "haiku" };
    expect(tierFor("review-fast", map)).toBe("opus");
    expect(tierFor("review-security", map)).toBe("sonnet");
    expect(tierFor("research", map)).toBe("haiku");
    expect(tierFor("Explore", map)).toBeNull();
    expect(tierFor(undefined, map)).toBeNull();
  });
});

describe("routeAgentInput", () => {
  it("searches on Haiku and everything that plans, decides or reviews on Sonnet", () => {
    expect(route("Explore")?.model).toBe("haiku");
    for (const type of [
      "Plan",
      "general-purpose",
      "review-security",
      "review-finding-verifier",
    ])
      expect(route(type)?.model).toBe("sonnet");
  });

  it("keeps the rest of the call", () => {
    expect(route("Explore", { description: "d" })).toEqual({
      subagent_type: "Explore",
      prompt: "p",
      description: "d",
      model: "haiku",
    });
  });

  it("leaves unknown types, forks and inherit alone", () => {
    expect(route("research")).toBeNull();
    expect(route("fork")).toBeNull();
    expect(
      routeAgentInput({ subagent_type: "Explore" }, { Explore: "inherit" })
    ).toBeNull();
    expect(routeAgentInput({ prompt: "no type" }, MAP)).toBeNull();
  });

  it("keeps a model the caller chose, but never runs a decider on Haiku", () => {
    expect(route("Explore", { model: "opus" })).toBeNull();
    expect(route("review-security", { model: "opus" })).toBeNull();
    expect(route("review-security", { model: "haiku" })?.model).toBe("sonnet");
    expect(route("Plan", { model: "haiku" })?.model).toBe("sonnet");
    expect(route("Explore", { model: "haiku" })).toBeNull();
  });
});

describe("settings", () => {
  it("overlays saved entries on the defaults", () => {
    setModelSettings({ subagents: { Explore: "sonnet", research: "haiku" } });
    expect(JSON.parse(subagentEnv().AGENTOS_SUBAGENT_MODELS)).toEqual({
      ...MAP,
      Explore: "sonnet",
      research: "haiku",
    });
    expect(effectiveSubagentModels({ Plan: "opus" }).Plan).toBe("opus");
  });

  it("refuses Haiku for a type that plans, decides or reviews", () => {
    for (const subagents of [
      { Plan: "haiku" },
      { "general-purpose": "haiku" },
      { "review-security": "haiku" },
      { "review-*": "haiku" },
      { "rev*": "haiku" },
    ])
      expect(() => setModelSettings({ subagents })).toThrow(/Haiku/);
    expect(() =>
      setModelSettings({ subagents: { Explore: "haiku" } })
    ).not.toThrow();
  });

  it("refuses a bad pattern or tier", () => {
    expect(() => setModelSettings({ subagents: { "a b": "haiku" } })).toThrow();
    expect(() => setModelSettings({ subagents: { "*": "haiku" } })).toThrow();
    expect(() => setModelSettings({ subagents: { x: "gpt" } })).toThrow();
  });

  it("is off for a routed provider", () => {
    const p = {
      ...PROVIDER_PRESETS.find((x) => x.id === "deepseek")!,
      auth: { kind: "keychain" as const, service: "s" },
    };
    const { env } = providerShellEnv(p, "m");
    expect(env.AGENTOS_SUBAGENT_MODELS).toBe("");
    expect(parseSubagentEnv(env.AGENTOS_SUBAGENT_MODELS)).toBeNull();
    expect(parseSubagentEnv('{"Explore":"haiku","x":"bogus"}')).toEqual({
      Explore: "haiku",
    });
    expect(parseSubagentEnv("not json")).toBeNull();
  });
});

describe("the SDK hook", () => {
  const input = (tool_name: string, tool_input: object) =>
    ({ hook_event_name: "PreToolUse", tool_name, tool_input }) as never;
  const run = (i: never) =>
    subagentModelHook(MAP)(i, "id", { signal: new AbortController().signal });

  it("sets the model without deciding permission", async () => {
    expect(
      await run(input("Agent", { subagent_type: "Explore", prompt: "p" }))
    ).toEqual({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        updatedInput: { subagent_type: "Explore", prompt: "p", model: "haiku" },
      },
    });
  });

  it("ignores other tools and calls it doesn't route", async () => {
    expect(await run(input("Bash", { subagent_type: "Explore" }))).toEqual({});
    expect(await run(input("Task", { subagent_type: "research" }))).toEqual({});
  });
});

describe("the terminal hook script", () => {
  const SCRIPT = join(process.cwd(), "scripts", "subagent-model-hook.mjs");
  const run = (stdin: string, map: unknown = MAP) =>
    spawnSync(process.execPath, [SCRIPT], {
      input: stdin,
      encoding: "utf-8",
      env: {
        NODE_ENV: "test",
        PATH: process.env.PATH,
        ...(map === undefined
          ? {}
          : { AGENTOS_SUBAGENT_MODELS: JSON.stringify(map) }),
      },
    });
  const call = (tool_name: string, subagent_type: string) =>
    JSON.stringify({ tool_name, tool_input: { subagent_type, prompt: "p" } });

  it("gives the same answer as the in-process rule", () => {
    for (const type of ["Explore", "Plan", "review-security", "research"]) {
      const r = run(call("Agent", type));
      const expected = route(type);
      expect(r.status).toBe(0);
      expect(
        r.stdout ? JSON.parse(r.stdout).hookSpecificOutput.updatedInput : null
      ).toEqual(expected);
    }
  });

  it("does nothing without a map, for other tools or on bad input", () => {
    for (const r of [
      run(call("Agent", "Explore"), null),
      run(call("Bash", "Explore")),
      run("not json"),
    ]) {
      expect(r.status).toBe(0);
      expect(r.stdout).toBe("");
    }
  });
});
