import { describe, it, expect } from "vitest";
import { groupTimeline, sameBlock } from "./group";
import type { ChatItem } from "./events";

const tool = (id: string): ChatItem => ({
  id,
  kind: "tool",
  name: "Bash",
  title: id,
  input: {},
  status: "done",
  createdAt: 0,
});
const text = (id: string): ChatItem => ({
  id,
  kind: "assistant",
  text: id,
  createdAt: 0,
});

describe("groupTimeline", () => {
  it("folds consecutive tool calls into one block", () => {
    const blocks = groupTimeline([
      text("a"),
      tool("t1"),
      tool("t2"),
      text("b"),
      tool("t3"),
    ]);
    expect(
      blocks.map((b) =>
        b.type === "tools"
          ? b.tools.map((t) => t.id).join("+")
          : b.type === "item"
            ? b.item.id
            : b.id
      )
    ).toEqual(["a", "t1+t2", "b", "t3"]);
  });

  it("keeps reasoning inside a run of tools out of the way", () => {
    const blocks = groupTimeline([
      tool("t1"),
      { id: "r", kind: "reasoning", text: "hmm", createdAt: 0 },
      tool("t2"),
    ]);
    expect(blocks).toHaveLength(1);
  });

  it("shows a skill on its own, between tool runs", () => {
    const skill: ChatItem = {
      id: "s",
      kind: "tool",
      name: "Skill",
      title: "Skill: ship",
      input: {},
      status: "done",
      createdAt: 0,
    };
    const blocks = groupTimeline([tool("t1"), skill, tool("t2")]);
    expect(blocks.map((b) => b.type)).toEqual(["tools", "item", "tools"]);
  });
});

const user = (id: string): ChatItem => ({
  id,
  kind: "user",
  text: id,
  checkpoint: `cp-${id}`,
  createdAt: 0,
});
const undo = (id: string, from: string): ChatItem => ({
  id,
  kind: "undo",
  from,
  filesChanged: 1,
  createdAt: 0,
});

describe("groupTimeline undo", () => {
  it("folds an undone message and its reply behind the undo", () => {
    const blocks = groupTimeline([
      user("u1"),
      text("a1"),
      user("u2"),
      tool("t1"),
      text("a2"),
      undo("x", "u2"),
      user("u3"),
    ]);
    expect(blocks.map((b) => b.type)).toEqual([
      "item",
      "item",
      "undone",
      "item",
    ]);
    const folded = blocks[2] as Extract<
      (typeof blocks)[number],
      { type: "undone" }
    >;
    expect(folded.items.map((i) => i.id)).toEqual(["u2", "t1", "a2"]);
    expect(folded.undo.id).toBe("x");
  });

  it("merges a second undo that goes back further", () => {
    const blocks = groupTimeline([
      user("u1"),
      text("a1"),
      user("u2"),
      undo("x", "u2"),
      user("u3"),
      undo("y", "u1"),
    ]);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("undone");
    expect(blocks[0].type === "undone" && blocks[0].id).toBe("y");
  });
});

describe("groupTimeline approvals", () => {
  const approval = (status: "pending" | "allowed"): ChatItem => ({
    id: `ap-${status}`,
    kind: "approval",
    toolName: "Bash",
    title: "ls",
    input: {},
    canAlways: false,
    status,
    createdAt: 0,
  });

  it("shows a pending approval on its own and hides a settled one", () => {
    const blocks = groupTimeline([
      tool("t1"),
      approval("allowed"),
      tool("t2"),
      approval("pending"),
    ]);
    expect(blocks.map((b) => b.type)).toEqual(["tools", "item"]);
    expect((blocks[0] as { tools: unknown[] }).tools).toHaveLength(2);
  });
});

describe("toolTitle", () => {
  it("reads MCP tools as server and words", async () => {
    const { toolTitle } = await import("./tools");
    expect(toolTitle("mcp__chrome-devtools__take_screenshot", {})).toBe(
      "chrome-devtools: take screenshot"
    );
  });
});

describe("sameBlock", () => {
  it("keeps every block but the one a streamed delta changed", () => {
    const items = [text("a"), tool("t1"), tool("t2"), text("b")];
    const before = groupTimeline(items);
    const b = items[3] as Extract<ChatItem, { kind: "assistant" }>;
    const after = groupTimeline([...items.slice(0, 3), { ...b, text: "b!" }]);
    expect(before.map((x, i) => sameBlock(x, after[i]))).toEqual([
      true,
      true,
      false,
    ]);
  });

  it("sees a tool group change when one of its calls finishes", () => {
    const t1 = tool("t1");
    const running = { ...tool("t2"), status: "running" } as ChatItem;
    expect(
      sameBlock(
        groupTimeline([t1, running])[0],
        groupTimeline([t1, tool("t2")])[0]
      )
    ).toBe(false);
  });

  it("sees a group that gained a call", () => {
    const t1 = tool("t1");
    expect(
      sameBlock(groupTimeline([t1])[0], groupTimeline([t1, tool("t2")])[0])
    ).toBe(false);
  });
});

describe("sameBlock on undone ranges", () => {
  const items = [user("u1"), user("u2"), text("a2"), undo("x", "u2")];
  const undone = (list: ChatItem[]) =>
    groupTimeline(list).find((b) => b.type === "undone")!;

  it("keeps a range rebuilt from the same items", () => {
    expect(sameBlock(undone(items), undone([...items]))).toBe(true);
  });

  it("sees a range whose message changed or whose undo was replaced", () => {
    const edited = [...items];
    edited[2] = {
      ...(items[2] as Extract<ChatItem, { kind: "assistant" }>),
      text: "a2!",
    };
    expect(sameBlock(undone(items), undone(edited))).toBe(false);
    const redone = [...items.slice(0, 3), { ...items[3] }];
    expect(sameBlock(undone(items), undone(redone))).toBe(false);
  });

  it("sees a range that gained an item", () => {
    const longer = [
      user("u1"),
      user("u2"),
      text("a2"),
      tool("t"),
      undo("x", "u2"),
    ];
    expect(sameBlock(undone(items), undone(longer))).toBe(false);
  });
});
