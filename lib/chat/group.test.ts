import { describe, it, expect } from "vitest";
import { groupTimeline } from "./group";
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
        b.type === "tools" ? b.tools.map((t) => t.id).join("+") : b.item.id
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
});
