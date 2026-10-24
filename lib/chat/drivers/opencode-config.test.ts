import fs from "fs";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  HEADER_TIMEOUT_MS,
  openCodeConfigContent,
  parseJsonc,
} from "./opencode-config";
import { tempDir } from "@/lib/test-temp";

let dir: string;
let env: Record<string, string>;
let cwd: string;

beforeEach(() => {
  dir = tempDir("opencode-config-");
  cwd = path.join(dir, "project");
  fs.mkdirSync(cwd);
  fs.mkdirSync(path.join(dir, "xdg", "opencode"), { recursive: true });
  env = { XDG_CONFIG_HOME: path.join(dir, "xdg") };
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const proc = (e: Record<string, string>) => e as unknown as NodeJS.ProcessEnv;

const build = (o: { model?: string; env?: Record<string, string> } = {}) =>
  JSON.parse(
    openCodeConfigContent({
      cwd,
      env: proc(o.env ?? env),
      model: o.model,
      pluginFile: "/guard/plugin.mjs",
    })
  ) as {
    provider: Record<string, { options?: Record<string, unknown> }>;
    plugin: string[];
  } & Record<string, unknown>;

describe("parseJsonc", () => {
  it("reads comments and trailing commas, and leaves strings alone", () => {
    expect(
      parseJsonc('{\n // a\n "url": "http://x/*y*/", /* b */ "n": [1, 2,],\n}')
    ).toEqual({ url: "http://x/*y*/", n: [1, 2] });
  });

  it("returns null for what isn't JSON", () => {
    expect(parseJsonc("nope")).toBeNull();
    expect(parseJsonc("[1]")).toBeNull();
  });
});

describe("openCodeConfigContent", () => {
  it("raises the header wait for providers in the user's configs", () => {
    fs.writeFileSync(
      path.join(dir, "xdg", "opencode", "opencode.jsonc"),
      '{ // mine\n "provider": { "local": { "npm": "x", "options": { "baseURL": "http://h/v1" } } } }'
    );
    fs.writeFileSync(
      path.join(cwd, "opencode.json"),
      JSON.stringify({ provider: { second: { options: {} } } })
    );
    const c = build();
    // Only the overlay: OpenCode merges it over the user's own entry.
    expect(c.provider.local).toEqual({
      options: { headerTimeout: HEADER_TIMEOUT_MS },
    });
    expect(c.provider.second.options?.headerTimeout).toBe(HEADER_TIMEOUT_MS);
  });

  it("covers the conversation's model provider", () => {
    expect(build({ model: "anthropic/claude-x" }).provider.anthropic).toEqual({
      options: { headerTimeout: HEADER_TIMEOUT_MS },
    });
  });

  it("keeps a header wait the user set", () => {
    fs.writeFileSync(
      path.join(cwd, "opencode.json"),
      JSON.stringify({
        provider: { local: { options: { headerTimeout: 99 } } },
      })
    );
    expect(build().provider.local).toBeUndefined();
  });

  it("keeps the user's own OPENCODE_CONFIG_CONTENT and plugins", () => {
    const c = build({
      env: {
        ...env,
        OPENCODE_CONFIG_CONTENT: JSON.stringify({
          theme: "dark",
          plugin: ["their-plugin"],
          provider: { mine: { options: { headerTimeout: false } } },
        }),
      },
    });
    expect(c.theme).toBe("dark");
    expect(c.plugin[0]).toBe("their-plugin");
    expect(c.plugin[1]).toBe("file:///guard/plugin.mjs");
    expect(c.provider.mine.options?.headerTimeout).toBe(false);
  });

  it("passes a value it can't read through untouched", () => {
    expect(
      openCodeConfigContent({
        cwd,
        env: proc({ ...env, OPENCODE_CONFIG_CONTENT: "{ nope" }),
      })
    ).toBe("{ nope");
  });
});
