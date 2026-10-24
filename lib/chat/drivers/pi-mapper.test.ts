import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatItem, DriverEvent } from "../events";
import { piTool, PiMapper } from "./pi-mapper";
import { piArgs, piImages } from "./pi";
import { PiDialogs } from "./pi-approvals";
import { RESULTS_BRIEF } from "./turn-outcome";

// Recorded from pi 0.73.1 in RPC mode (partials elided); the abort from its
// docs.
const records = readFileSync(
  join(__dirname, "__fixtures__", "pi-turns.jsonl"),
  "utf8"
)
  .trim()
  .split("\n")
  .map((l) => JSON.parse(l) as Record<string, unknown>);

function replay() {
  const events: DriverEvent[] = [];
  const mapper = new PiMapper((e) => events.push(e));
  for (const r of records) {
    mapper.map(r);
    // The driver ends the turn once Pi says it's idle after a run.
    if (r.type === "agent_end") mapper.endTurn();
  }
  const items = new Map<string, ChatItem>();
  for (const e of events) if (e.type === "item") items.set(e.item.id, e.item);
  return { events, items: [...items.values()] };
}

describe("PiMapper compaction", () => {
  const run = (...events: Record<string, unknown>[]) => {
    const out: DriverEvent[] = [];
    const mapper = new PiMapper((e) => out.push(e));
    for (const e of events) mapper.map(e);
    return out;
  };

  it("is compacting from its start to its end, failed or not", () => {
    expect(
      run({ type: "compaction_start" }, { type: "compaction_end", result: {} })
    ).toMatchObject([
      { type: "compacting", active: true },
      { type: "compacting", active: false },
      { type: "item", item: { kind: "compacted" } },
    ]);
    expect(
      run({ type: "compaction_start" }, { type: "compaction_end" })
    ).toEqual([
      { type: "compacting", active: true },
      { type: "compacting", active: false },
    ]);
  });
});

describe("PiMapper", () => {
  it("turns a recorded run into chat items, one turn per run", () => {
    const { events, items } = replay();
    const texts = items
      .filter((i) => i.kind === "assistant" || i.kind === "reasoning")
      .map((i) => [i.kind, "text" in i && i.text]);
    expect(texts).toEqual([
      ["reasoning", "**Listing**"],
      ["assistant", "Two files."],
      ["assistant", "partial"],
    ]);
    const tool = items.find((i) => i.kind === "tool");
    expect(tool).toMatchObject({
      name: "Bash",
      title: "ls",
      status: "done",
      output: "a.txt\nb.txt\n",
    });
    const ends = items.filter((i) => i.kind === "turn_end");
    expect(ends.map((e) => e.kind === "turn_end" && !!e.interrupted)).toEqual([
      false,
      true,
    ]);
    expect(events.filter((e) => e.type === "turn_start")).toHaveLength(2);
  });

  it("adds up usage and cost across the run's answers", () => {
    const usage = replay().events.find((e) => e.type === "usage");
    expect(usage).toEqual({
      type: "usage",
      totals: {
        costUsd: 0.0005949 + 0.0005012,
        inputTokens: 1608 + 1529,
        outputTokens: 45 + 17,
        cacheReadTokens: 100,
        cacheWriteTokens: 0,
      },
    });
  });

  it("shows Pi's edits as diffs", () => {
    expect(
      piTool("edit", {
        path: "/w/a.ts",
        edits: [{ oldText: "a = 1", newText: "a = 2" }],
      })
    ).toMatchObject({
      name: "Edit",
      diff: { path: "/w/a.ts", before: "a = 1", after: "a = 2" },
    });
  });
});

describe("PiDialogs", () => {
  it("asks before a tool, and remembers 'always' for that tool", async () => {
    const events: DriverEvent[] = [];
    const dialogs = new PiDialogs((e) => events.push(e));
    const request = {
      id: "u1",
      method: "confirm",
      title: "agentos:call_1",
      message: JSON.stringify({ tool: "bash", input: { command: "rm x" } }),
    };
    const answer = dialogs.handle(request);
    expect(events[0]).toMatchObject({
      item: { id: "approval-call_1", toolName: "Bash", title: "rm x" },
    });
    dialogs.pending.respond("approval-call_1", { decision: "always" });
    expect(await answer).toEqual({ confirmed: true });
    expect(
      await dialogs.handle({ ...request, title: "agentos:call_2" })
    ).toEqual({ confirmed: true });
  });

  it("refuses when the conversation ends first", async () => {
    const dialogs = new PiDialogs(() => {});
    const answer = dialogs.handle({
      id: "u1",
      method: "confirm",
      title: "agentos:c",
      message: "{}",
    });
    dialogs.pending.expireAll();
    expect(await answer).toEqual({ confirmed: false });
  });
});

describe("pi arguments", () => {
  it("resumes by session file and leaves the default model to Pi", () => {
    expect(
      piArgs(
        {
          cwd: "/w",
          model: "default",
          access: "full",
          env: {},
          resumeId: "/s/1.jsonl",
          systemAppend: "brief",
        },
        "/ext.mjs",
        "/more.mjs"
      )
    ).toEqual([
      "-e",
      "/ext.mjs",
      "-e",
      "/more.mjs",
      "--session",
      "/s/1.jsonl",
      "--append-system-prompt",
      `brief\n\n${RESULTS_BRIEF}`,
    ]);
    expect(piImages([{ mediaType: "image/png", data: "QQ==" }])).toEqual([
      { type: "image", data: "QQ==", mimeType: "image/png" },
    ]);
  });
});

describe("PiMapper turns that end early", () => {
  const run = (...events: Record<string, unknown>[]) => {
    const out: DriverEvent[] = [];
    const mapper = new PiMapper((e) => out.push(e));
    for (const e of events) mapper.map(e);
    mapper.endTurn();
    const items = new Map<string, ChatItem>();
    for (const e of out) if (e.type === "item") items.set(e.item.id, e.item);
    const end = [...items.values()].find((i) => i.kind === "turn_end");
    return { out, items: [...items.values()], end };
  };
  const answer = (
    text: string,
    stopReason: string,
    extra: Record<string, unknown> = {}
  ) => [
    { type: "agent_start" },
    { type: "message_start", message: { role: "assistant" } },
    {
      type: "message_update",
      assistantMessageEvent: {
        type: "text_delta",
        contentIndex: 0,
        delta: text,
      },
    },
    {
      type: "message_update",
      assistantMessageEvent: {
        type: "text_end",
        contentIndex: 0,
        content: text,
      },
    },
    {
      type: "message_end",
      message: {
        role: "assistant",
        stopReason,
        provider: "stub",
        model: "qwen-stub",
        api: "openai-completions",
        content: [{ type: "text", text }],
        ...extra,
      },
    },
  ];
  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => warn.mockRestore());

  it("flags a reply that announces an action and calls nothing", () => {
    const { end } = run(...answer("First, let me run typecheck.", "stop"));
    expect(end).toMatchObject({
      finishReason: "stop",
      ended: { reason: "no_tool_call" },
    });
    const [, json] = warn.mock.calls[0] as [string, string];
    expect(JSON.parse(json)).toMatchObject({
      driver: "pi",
      provider: "stub",
      model: "qwen-stub",
      finishReason: "stop",
      reason: "no_tool_call",
    });
  });

  it("flags a reply cut off by the output limit", () => {
    const { end } = run(...answer("The plan is to", "length"));
    expect(end).toMatchObject({
      finishReason: "length",
      ended: { reason: "length" },
    });
    expect(warn).toHaveBeenCalledOnce();
  });

  it("flags tool-call markup nothing ran, and an empty reply", () => {
    expect(
      run(...answer('<tool_call>{"name":"bash"', "stop")).end
    ).toMatchObject({ ended: { reason: "parse_failure" } });
    expect(run(...answer("", "stop")).end).toMatchObject({
      ended: { reason: "empty" },
    });
  });

  it("cleans the text of a call the text-tools extension made", () => {
    const { items, end } = run(
      ...answer("Running it.\n<tool_call>x</tool_call>", "toolUse", {
        content: [
          { type: "text", text: "Running it." },
          { type: "toolCall", id: "aostext_1_a", name: "bash", arguments: {} },
        ],
        aosRecovered: { index: 0, text: "Running it." },
      })
    );
    const texts = items.filter((i) => i.kind === "assistant");
    expect(texts).toHaveLength(1);
    expect(texts[0]).toMatchObject({ text: "Running it." });
    expect(end?.kind === "turn_end" && end.ended).toBeUndefined();
  });

  it("stays quiet for finished work, an abort and the recorded turns", () => {
    expect(run(...answer("All done.", "stop")).end).not.toHaveProperty(
      "ended.reason"
    );
    expect(
      run(...answer("First, let me run it.", "aborted")).end
    ).toMatchObject({ interrupted: true });
    expect(warn).not.toHaveBeenCalled();
    const { events } = replay();
    for (const e of events)
      if (e.type === "item" && e.item.kind === "turn_end")
        expect(e.item.ended).toBeUndefined();
  });
});

describe("PiMapper summary nudge", () => {
  const msg = (text: string) => ({
    type: "message_end",
    message: {
      role: "assistant",
      stopReason: "stop",
      content: [{ type: "text", text }],
    },
  });
  const tool = {
    type: "tool_execution_start",
    toolCallId: "t1",
    toolName: "bash",
    args: {},
  };

  it("wants a summary after tools and a lead-in, and keeps the count through a nudged run", () => {
    const mapper = new PiMapper(() => {});
    mapper.map({ type: "agent_start" });
    mapper.map(tool);
    mapper.map(msg("Here's what I found:"));
    expect(mapper.needsSummary()).toBe(true);
    mapper.map({ type: "agent_start" });
    mapper.map(msg(""));
    expect(mapper.needsSummary()).toBe(true);
    mapper.map(msg("All reachable."));
    expect(mapper.needsSummary()).toBe(false);
  });

  it("doesn't after a turn without tools, nor in the next turn once reset", () => {
    const mapper = new PiMapper(() => {});
    mapper.map({ type: "agent_start" });
    mapper.map(msg("Let me look:"));
    expect(mapper.needsSummary()).toBe(false);
    mapper.map(tool);
    mapper.endTurn();
    mapper.map({ type: "agent_start" });
    mapper.map(msg("Let me look:"));
    expect(mapper.needsSummary()).toBe(false);
  });

  it("always puts the results brief in the system prompt", () => {
    expect(piArgs({ systemAppend: "brief" } as never).join(" ")).toContain(
      RESULTS_BRIEF
    );
    expect(piArgs({} as never).join(" ")).toContain(RESULTS_BRIEF);
  });
});

describe("PiMapper live tool output", () => {
  const start = {
    type: "tool_execution_start",
    toolCallId: "c1",
    toolName: "bash",
    args: { command: "make" },
  };
  const update = (text: string) => ({
    type: "tool_execution_update",
    toolCallId: "c1",
    toolName: "bash",
    args: { command: "make" },
    partialResult: { content: [{ type: "text", text }] },
  });
  const setup = () => {
    vi.useFakeTimers();
    const out: DriverEvent[] = [];
    const mapper = new PiMapper((e) => out.push(e));
    const tools = () =>
      out.flatMap((e) =>
        e.type === "item" && e.item.kind === "tool" ? [e.item] : []
      );
    return { mapper, tools };
  };
  afterEach(() => vi.useRealTimers());

  it("puts partial output on the running step", () => {
    const { mapper, tools } = setup();
    mapper.map(start);
    mapper.map(update("compiling a"));
    expect(tools().at(-1)).toMatchObject({
      status: "running",
      output: "compiling a",
    });
  });

  it("keeps only the tail of a noisy command", () => {
    const { mapper, tools } = setup();
    mapper.map(start);
    mapper.map(
      update(Array.from({ length: 1000 }, (_, i) => `line ${i}`).join("\n"))
    );
    const lines = tools().at(-1)!.output!.split("\n");
    expect(lines.length).toBeLessThanOrEqual(201);
    expect(lines.at(-1)).toBe("line 999");
    expect(lines).not.toContain("line 0");
  });

  it("sends updates no faster than the throttle", () => {
    const { mapper, tools } = setup();
    mapper.map(start);
    mapper.map(update("a"));
    mapper.map(update("ab"));
    expect(tools()).toHaveLength(2);
    vi.advanceTimersByTime(300);
    mapper.map(update("abc"));
    expect(tools().at(-1)!.output).toBe("abc");
  });

  it("replaces the partial output with the final result", () => {
    const { mapper, tools } = setup();
    mapper.map(start);
    mapper.map(update("partial"));
    mapper.map({
      type: "tool_execution_end",
      toolCallId: "c1",
      toolName: "bash",
      isError: false,
      result: { content: [{ type: "text", text: "final" }] },
    });
    expect(tools().at(-1)).toMatchObject({ status: "done", output: "final" });
  });
});

describe("PiMapper retries", () => {
  const HEADERS = "Provider response headers timed out after 300000ms";
  const failed = [
    { type: "agent_start" },
    {
      type: "message_end",
      message: {
        role: "assistant",
        stopReason: "error",
        errorMessage: HEADERS,
        content: [],
      },
    },
  ];

  function drive() {
    const out: DriverEvent[] = [];
    const retries: unknown[] = [];
    const mapper = new PiMapper(
      (e) => out.push(e),
      (d) => retries.push(d)
    );
    const ends = () =>
      out.flatMap((e) =>
        e.type === "item" && e.item.kind === "turn_end" ? [e.item] : []
      );
    return { mapper, out, retries, ends };
  }

  it("holds the turn open and asks for a retry", () => {
    const { mapper, retries, ends } = drive();
    for (const e of failed) mapper.map(e);
    mapper.endTurn();
    expect(retries).toHaveLength(1);
    expect(ends()).toHaveLength(0);
    expect(mapper.retrying).toBe(true);
  });

  it("reports after three retries", () => {
    const { mapper, retries, ends } = drive();
    for (let i = 0; i < 4; i++) {
      for (const e of failed) mapper.map(e);
      mapper.endTurn();
    }
    expect(retries).toHaveLength(3);
    expect(ends()[0].ended?.notice).toContain("3 retries didn't get through");
  });

  it("leaves it to Pi when Pi retried, and shows its retries", () => {
    const { mapper, retries, ends, out } = drive();
    mapper.map({ type: "agent_start" });
    mapper.map({
      type: "auto_retry_start",
      attempt: 1,
      maxAttempts: 3,
      errorMessage: HEADERS,
    });
    mapper.map(failed[1]);
    mapper.endTurn();
    expect(retries).toHaveLength(0);
    expect(ends()[0].ended?.notice).toContain("even after the agent retried");
    expect(out.some((e) => e.type === "item" && e.item.kind === "note")).toBe(
      true
    );
  });
});

describe("PiMapper request reports", () => {
  it("reports the prompt a response was measured on, and retries", () => {
    const out: DriverEvent[] = [];
    const mapper = new PiMapper((e) => out.push(e));
    mapper.map({ type: "agent_start" });
    mapper.map({
      type: "message_end",
      message: {
        role: "assistant",
        content: [],
        usage: { input: 100, cacheRead: 40, cacheWrite: 10, output: 3 },
      },
    });
    mapper.map({
      type: "auto_retry_start",
      attempt: 1,
      errorMessage: "overloaded",
    });
    expect(out).toContainEqual({ type: "prompt_tokens", tokens: 150 });
    expect(out).toContainEqual({
      type: "model_retry",
      attempt: 1,
      message: "overloaded",
    });
  });

  it("says nothing of the prompt when usage is missing", () => {
    const out: DriverEvent[] = [];
    const mapper = new PiMapper((e) => out.push(e));
    mapper.map({ type: "agent_start" });
    mapper.map({ type: "message_end", message: { role: "assistant" } });
    expect(out.some((e) => e.type === "prompt_tokens")).toBe(false);
  });
});
