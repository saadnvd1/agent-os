import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatItem, DriverEvent } from "../events";
import { piTool, PiMapper } from "./pi-mapper";
import { piArgs, piImages } from "./pi";
import { PiDialogs } from "./pi-approvals";

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
      "brief",
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
