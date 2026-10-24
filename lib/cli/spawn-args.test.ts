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
