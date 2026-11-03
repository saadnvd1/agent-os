import { spawnSync } from "child_process";
import { createRequire } from "module";
import { describe, expect, it } from "vitest";

const parse = createRequire(import.meta.url)(
  "../../bin/aos-lib/spawn-args.js"
) as (words: string[], fail: (m: string) => never) => Record<string, unknown>;
const fail = (m: string): never => {
  throw new Error(m);
};

describe("aos spawn --model", () => {
  it("reads the model beside a role, before the prompt", () => {
    expect(
      parse(
        ["app", "--role", "analyst", "--model", "pi/local/qwen3", "look", "x"],
        fail
      )
    ).toMatchObject({
      project: "app",
      role: "analyst",
      model: "pi/local/qwen3",
      prompt: ["look", "x"],
    });
    expect(parse(["app", "--model=ollama/qwen3.8", "go"], fail).model).toBe(
      "ollama/qwen3.8"
    );
  });

  it("leaves --model in the prompt once the prompt has started", () => {
    expect(parse(["app", "fix", "--model", "x"], fail)).toMatchObject({
      model: undefined,
      prompt: ["fix", "--model", "x"],
    });
  });

  it("needs a value", () => {
    expect(() => parse(["app", "--model"], fail)).toThrow(/--model needs/);
  });
});

describe("aos --agent and --model without a role", () => {
  it("reads --model with no role, for spawn and task alike", () => {
    expect(parse(["app", "--model", "gpt-5", "go"], fail)).toMatchObject({
      model: "gpt-5",
      role: undefined,
    });
  });

  it("reads --agent, both spellings, before the prompt only", () => {
    expect(parse(["app", "--agent", "Copilot", "go"], fail).agent).toBe(
      "copilot"
    );
    expect(parse(["app", "--agent=codex", "go"], fail).agent).toBe("codex");
    expect(parse(["app", "go", "--agent", "x"], fail).agent).toBeUndefined();
    expect(() => parse(["app", "--agent"], fail)).toThrow(/--agent needs/);
  });
});

describe("bin/aos spawn and task flags", () => {
  const run = (...args: string[]) =>
    spawnSync(process.execPath, ["bin/aos", ...args], {
      encoding: "utf8",
      env: { ...process.env, AGENTOS_URL: "http://127.0.0.1:1" },
    });

  it("refuses --agent with --role or --terminal", () => {
    expect(
      run("spawn", "app", "--agent", "codex", "--role", "analyst", "x").stderr
    ).toMatch(/--agent doesn't work with --role/);
    expect(
      run("task", "app", "--agent", "codex", "--terminal", "x").stderr
    ).toMatch(/--agent doesn't work with --terminal/);
  });

  it("no longer demands --role for --model", () => {
    expect(run("task", "app", "--model", "m", "x").stderr).not.toMatch(
      /works with --role/
    );
  });
});
