import { afterEach, describe, expect, it, vi } from "vitest";

// The SDK's query, as a stub that records the options it was started with
// and each permission mode switch.
const calls = vi.hoisted(() => ({
  options: [] as Record<string, unknown>[],
  modes: [] as string[],
  // What the agent says it restored on starting; never answers by default.
  usage: () => new Promise<unknown>(() => {}),
}));
vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  getSessionMessages: vi.fn(),
  query: ({ options }: { options: Record<string, unknown> }) => {
    calls.options.push(options);
    return {
      setPermissionMode: async (mode: string) => {
        calls.modes.push(mode);
      },
      close: () => {},
      usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET: () =>
        calls.usage(),
      // A conversation that never says anything.
      [Symbol.asyncIterator]: () => ({
        next: () => new Promise(() => {}),
      }),
    };
  },
}));

const { claudeDriver, writtenPlanFile } = await import("./claude");

function start(extra: Record<string, unknown> = {}) {
  calls.options.length = 0;
  calls.modes.length = 0;
  return claudeDriver.start({
    cwd: "/tmp",
    model: "sonnet",
    access: "full",
    env: {},
    ...extra,
  });
}

describe("plan mode in the driver", () => {
  it("starts in plan mode when the session is planning", () => {
    start({ plan: true }).close();
    expect(calls.options[0].permissionMode).toBe("plan");
  });

  it("keeps planning when access changes, then leaves for the new access", async () => {
    const c = start({ plan: true, access: "full" });
    await c.setAccess("edits");
    expect(calls.modes).toEqual([]);
    await c.setPlan(false);
    expect(calls.modes).toEqual(["acceptEdits"]);
    await c.setPlan(true);
    expect(calls.modes).toEqual(["acceptEdits", "plan"]);
    c.close();
  });

  it("never moves a fixed permission mode (an orchestrator's)", async () => {
    const c = start({ plan: true, permissionMode: "dontAsk" });
    expect(calls.options[0].permissionMode).toBe("dontAsk");
    await c.setPlan(false);
    await c.setAccess("ask");
    expect(calls.modes).toEqual([]);
    c.close();
  });
});

describe("the totals a conversation starts from", () => {
  afterEach(() => {
    calls.usage = () => new Promise(() => {});
  });

  it("reports what the agent restored", async () => {
    calls.usage = async () => ({
      session: {
        total_cost_usd: 0.3,
        model_usage: {
          sonnet: {
            inputTokens: 10,
            outputTokens: 5,
            cacheReadInputTokens: 100,
            cacheCreationInputTokens: 20,
            costUSD: 0.3,
          },
        },
      },
    });
    const c = start();
    const first = await c.events[Symbol.asyncIterator]().next();
    expect(first.value).toEqual({
      type: "usage_start",
      totals: {
        costUsd: 0.3,
        inputTokens: 10,
        outputTokens: 5,
        cacheReadTokens: 100,
        cacheWriteTokens: 20,
      },
    });
    c.close();
  });

  it("says nothing when the agent can't tell", async () => {
    calls.usage = async () => {
      throw new Error("not supported");
    };
    const c = start();
    const next = c.events[Symbol.asyncIterator]().next();
    const quiet = new Promise((r) => setTimeout(() => r("nothing"), 20));
    expect(await Promise.race([next, quiet])).toBe("nothing");
    c.close();
  });
});

describe("writtenPlanFile", () => {
  const message = (name: string, file_path: string) => ({
    type: "assistant",
    message: {
      content: [{ type: "tool_use", id: "t", name, input: { file_path } }],
    },
  });
  const plan = "/Users/x/.claude/plans/quiet-otter.md";

  it("is the plan file the agent writes or edits", () => {
    expect(writtenPlanFile(message("Write", plan))).toBe(plan);
    expect(writtenPlanFile(message("Edit", plan))).toBe(plan);
  });

  it("isn't a plan the agent only reads, or another file it writes", () => {
    expect(writtenPlanFile(message("Read", plan))).toBeUndefined();
    expect(
      writtenPlanFile(message("Write", "/repo/docs/plans/x.md"))
    ).toBeUndefined();
    expect(
      writtenPlanFile(message("Write", "/repo/README.md"))
    ).toBeUndefined();
  });
});
