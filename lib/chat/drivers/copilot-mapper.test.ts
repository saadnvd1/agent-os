import { describe, expect, it } from "vitest";
import type { ChatItem, DriverEvent } from "../events";
import { CopilotMapper, toolStart } from "./copilot-mapper";

function run(updates: Record<string, unknown>[]) {
  const events: DriverEvent[] = [];
  const mapper = new CopilotMapper((e) => events.push(e));
  for (const u of updates) mapper.map(u);
  const items = () => {
    const byId = new Map<string, ChatItem>();
    for (const e of events) if (e.type === "item") byId.set(e.item.id, e.item);
    return [...byId.values()];
  };
  return { mapper, events, items };
}

const chunk = (text: string) => ({
  sessionUpdate: "agent_message_chunk",
  content: { type: "text", text },
});

describe("CopilotMapper", () => {
  it("streams a reply into one bubble and ends the turn idle", () => {
    const { mapper, events, items } = run([chunk("Hel"), chunk("lo")]);
    mapper.endTurn({});
    const reply = items().find((i) => i.kind === "assistant");
    expect(reply).toMatchObject({ kind: "assistant", text: "Hello" });
    expect(items().some((i) => i.kind === "turn_end")).toBe(true);
    expect(events.at(-1)).toEqual({ type: "state", state: "idle" });
  });

  it("splits the text around a tool call and finishes the call with its diff", () => {
    const { mapper, items } = run([
      chunk("Looking."),
      {
        sessionUpdate: "tool_call",
        toolCallId: "t1",
        title: "apply_patch",
        kind: "edit",
        status: "pending",
        rawInput: "*** Begin Patch\n*** Update File: src/a.ts\n@@\n-x\n+y\n",
      },
      {
        sessionUpdate: "tool_call_update",
        toolCallId: "t1",
        status: "completed",
        content: [
          { type: "diff", path: "/w/src/a.ts", oldText: "x\n", newText: "y\n" },
        ],
      },
      chunk("Done."),
    ]);
    mapper.endTurn({});
    const kinds = items().map((i) => i.kind);
    expect(kinds.filter((k) => k === "assistant")).toHaveLength(2);
    const tool = items().find((i) => i.kind === "tool");
    expect(tool).toMatchObject({
      name: "Edit",
      status: "done",
      diff: { path: "/w/src/a.ts", before: "x\n", after: "y\n" },
    });
  });

  it("marks a failed call as an error and a cut-off one as stopped", () => {
    const { mapper, items } = run([
      {
        sessionUpdate: "tool_call",
        toolCallId: "a",
        kind: "execute",
        title: "ls",
        rawInput: { command: "ls" },
      },
      {
        sessionUpdate: "tool_call_update",
        toolCallId: "a",
        status: "failed",
        rawOutput: { content: "boom" },
      },
      {
        sessionUpdate: "tool_call",
        toolCallId: "b",
        kind: "execute",
        title: "sleep",
        rawInput: { command: "sleep 9" },
      },
    ]);
    mapper.endTurn({ interrupted: true });
    const tools = items().filter((i) => i.kind === "tool");
    expect(tools.map((t) => (t as { status: string }).status)).toEqual([
      "error",
      "stopped",
    ]);
  });

  it("ignores the history replayed while a conversation loads", () => {
    const { mapper, events } = run([]);
    mapper.replaying = true;
    mapper.map(chunk("old"));
    mapper.replaying = false;
    expect(events).toEqual([]);
  });

  it("counts a prompt's tokens without the cached part twice", () => {
    const { mapper, events } = run([]);
    mapper.spent({
      inputTokens: 1000,
      outputTokens: 20,
      cachedReadTokens: 600,
      cachedWriteTokens: 300,
    });
    mapper.items.startTurn();
    mapper.endTurn({});
    expect(events.find((e) => e.type === "usage")).toMatchObject({
      totals: {
        inputTokens: 100,
        outputTokens: 20,
        cacheReadTokens: 600,
        cacheWriteTokens: 300,
      },
    });
  });

  it("reports context use and the plan", () => {
    const { events } = run([
      { sessionUpdate: "usage_update", used: 500, size: 1000 },
      {
        sessionUpdate: "plan",
        entries: [{ content: "step", status: "in_progress" }],
      },
    ]);
    expect(events[0]).toMatchObject({
      type: "context",
      context: { usedTokens: 500, percentage: 50 },
    });
    expect(events[1]).toMatchObject({
      item: { kind: "todos", todos: [{ text: "step", status: "in_progress" }] },
    });
  });
});

describe("toolStart", () => {
  it("names a shell call Bash with its command", () => {
    expect(
      toolStart({ kind: "execute", title: "x", rawInput: { command: "ls -l" } })
    ).toMatchObject({ name: "Bash", input: { command: "ls -l" } });
  });

  it("names a file search Glob and a view Read", () => {
    expect(
      toolStart({ kind: "read", rawInput: { pattern: "**/*.ts" } }).name
    ).toBe("Glob");
    expect(
      toolStart({ kind: "read", rawInput: { path: "/w/a.ts" } }).name
    ).toBe("Read");
  });
});
