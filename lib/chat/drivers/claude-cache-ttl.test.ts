import { describe, expect, it, vi } from "vitest";
import type { DriverEvent } from "../events";

// The SDK's query, replaying a scripted conversation, and a context report
// after each result.
const script = vi.hoisted(() => ({ messages: [] as unknown[] }));

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  getSessionMessages: vi.fn(),
  query: () => ({
    interrupt: async () => {},
    close: () => {},
    usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET: () =>
      new Promise(() => {}),
    getContextUsage: async () => ({
      totalTokens: 412_000,
      maxTokens: 1_000_000,
      percentage: 41,
      categories: [],
    }),
    async *[Symbol.asyncIterator]() {
      for (const m of script.messages) yield m;
    },
  }),
}));

const { claudeDriver } = await import("./claude");

const assistant = (cache: object | null, parent: string | null = null) => ({
  type: "assistant",
  parent_tool_use_id: parent,
  message: {
    id: `m-${Math.random()}`,
    content: [{ type: "text", text: "ok" }],
    usage: { input_tokens: 3, output_tokens: 1, cache_creation: cache },
  },
});
const result = { type: "result", subtype: "success", modelUsage: {} };

async function contexts(messages: unknown[]) {
  script.messages = messages;
  const c = claudeDriver.start({
    cwd: "/tmp",
    model: "sonnet",
    access: "full",
    env: {},
  });
  const seen: number[] = [];
  const results = messages.filter((m) => m === result).length;
  for await (const e of c.events as AsyncIterable<DriverEvent>) {
    if (e.type !== "context") continue;
    seen.push(e.context.cacheTtlMs ?? 0);
    if (seen.length === results) break;
  }
  c.close();
  return seen;
}

describe("claude driver cache lifetime", () => {
  it("reports the lifetime its turns write with, kept across turns that only read", async () => {
    expect(
      await contexts([
        assistant({
          ephemeral_1h_input_tokens: 4229,
          ephemeral_5m_input_tokens: 0,
        }),
        result,
        assistant({
          ephemeral_1h_input_tokens: 0,
          ephemeral_5m_input_tokens: 0,
        }),
        result,
      ])
    ).toEqual([60 * 60_000, 60 * 60_000]);
  });

  it("reads a 5-minute cache, and not a subagent's", async () => {
    expect(
      await contexts([
        assistant({
          ephemeral_1h_input_tokens: 0,
          ephemeral_5m_input_tokens: 900,
        }),
        assistant(
          { ephemeral_1h_input_tokens: 500, ephemeral_5m_input_tokens: 0 },
          "tool-1"
        ),
        result,
      ])
    ).toEqual([5 * 60_000]);
  });

  it("says nothing until a turn writes the cache", async () => {
    expect(await contexts([assistant(null), result])).toEqual([0]);
  });
});
