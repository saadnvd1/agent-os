import { describe, expect, it } from "vitest";
import { usageEvents } from "./claude";

const assistant = (parent?: string) =>
  ({
    type: "assistant",
    parent_tool_use_id: parent,
    message: {
      id: "m1",
      model: "claude-x",
      content: [],
      usage: {
        input_tokens: 10,
        cache_read_input_tokens: 900,
        cache_creation_input_tokens: 90,
        output_tokens: 5,
      },
    },
  }) as never;

describe("usageEvents prompt size", () => {
  it("reports the main call's prompt as input plus cache", () => {
    const e = usageEvents(assistant(), new Map(), 1);
    expect(e).toContainEqual({ type: "prompt_tokens", tokens: 1000 });
  });

  it("leaves a subagent's call out", () => {
    const e = usageEvents(assistant("t1"), new Map(), 1);
    expect(e.some((x) => x.type === "prompt_tokens")).toBe(false);
  });
});
