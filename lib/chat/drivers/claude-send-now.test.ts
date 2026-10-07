import { describe, expect, it, vi } from "vitest";

// The SDK's query, as a stub that records interrupts and what's sent, in
// the order they happen.
const calls = vi.hoisted(() => ({
  order: [] as string[],
  prompt: null as AsyncIterable<{ priority?: string }> | null,
}));

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  getSessionMessages: vi.fn(),
  query: ({ prompt }: { prompt: AsyncIterable<{ priority?: string }> }) => {
    calls.prompt = prompt;
    return {
      interrupt: async () => {
        calls.order.push("interrupt");
      },
      close: () => {},
      usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET: () =>
        new Promise(() => {}),
      [Symbol.asyncIterator]: () => ({ next: () => new Promise(() => {}) }),
    };
  },
}));

const { claudeDriver } = await import("./claude");

async function sent() {
  const next = await calls.prompt![Symbol.asyncIterator]().next();
  calls.order.push(`message:${next.value.priority ?? "default"}`);
}

describe("claude driver send now", () => {
  it("stops the turn first, and sends the message ahead of anything queued", async () => {
    calls.order.length = 0;
    const c = claudeDriver.start({
      cwd: "/tmp",
      model: "sonnet",
      access: "full",
      env: {},
    });
    c.send("first");
    await sent();
    c.send("instead", undefined, { now: true });
    await sent();
    expect(calls.order).toEqual([
      "message:default",
      "interrupt",
      "message:now",
    ]);
    c.close();
  });
});
