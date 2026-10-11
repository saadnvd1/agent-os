import { describe, expect, it } from "vitest";
import { z } from "zod";
import { TOOL_SHAPES } from "./tool-schemas";

// Keywords Claude Code won't take in a tool's input schema. One of them in
// any tool makes it drop every tool on the server: on 2026-10-11 a
// z.partialRecord left the orchestrator with none.
const REFUSED = ["propertyNames"];

function keywords(node: unknown, found = new Set<string>()): Set<string> {
  if (Array.isArray(node)) node.forEach((n) => keywords(n, found));
  else if (node && typeof node === "object")
    for (const [key, value] of Object.entries(node)) {
      found.add(key);
      keywords(value, found);
    }
  return found;
}

describe("orchestrator tool schemas", () => {
  it.each(Object.keys(TOOL_SHAPES))(
    "%s uses no keyword Claude Code refuses",
    (name) => {
      const shape = TOOL_SHAPES[name as keyof typeof TOOL_SHAPES];
      const used = keywords(z.toJSONSchema(z.object(shape)));
      expect(REFUSED.filter((k) => used.has(k))).toEqual([]);
    }
  );

  it("takes a model as one ref or a map of role to ref, and refuses other keys", () => {
    const model = z.object(TOOL_SHAPES.set_task_model).shape.model;
    expect(model.safeParse("deepseek/deepseek-v4-pro").success).toBe(true);
    expect(
      model.safeParse({ implement: "deepseek/deepseek-v4-pro" }).success
    ).toBe(true);
    expect(
      model.safeParse({ review: "deepseek/deepseek-v4-pro" }).success
    ).toBe(false);
    expect(model.safeParse("deepseek").success).toBe(false);
  });

  it("makes start_task state its plan decision and why", () => {
    const task = z.object(TOOL_SHAPES.start_task);
    const base = { project: "app", prompt: "do it" };
    expect(task.safeParse(base).success).toBe(false);
    expect(task.safeParse({ ...base, plan: false }).success).toBe(false);
    expect(
      task.safeParse({ ...base, plan: false, plan_reason: "  " }).success
    ).toBe(false);
    expect(
      task.safeParse({ ...base, plan: true, plan_reason: "touches 6 files" })
        .success
    ).toBe(true);
  });

  it("takes one ref as a session's model, and nothing else", () => {
    const model = z.object(TOOL_SHAPES.start_session).shape.model;
    expect(model.safeParse(undefined).success).toBe(true);
    expect(model.safeParse("anthropic/claude-opus-5-5").success).toBe(true);
    expect(model.safeParse("opus").success).toBe(false);
  });
});
