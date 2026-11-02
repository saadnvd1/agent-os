import { describe, expect, it } from "vitest";
import { cutPoint, type TranscriptEntry } from "./point";

const use = (uuid: string, id: string): TranscriptEntry => ({
  type: "assistant",
  uuid,
  message: { content: [{ type: "tool_use", id }] },
});
const result = (uuid: string, id: string): TranscriptEntry => ({
  type: "user",
  uuid,
  message: { content: [{ type: "tool_result", tool_use_id: id }] },
});
const said = (uuid: string, type = "assistant"): TranscriptEntry => ({
  type,
  uuid,
  message: { content: [{ type: "text" }] },
});

describe("cutPoint", () => {
  it("cuts at the end when every tool call has its result", () => {
    expect(
      cutPoint([
        said("u1", "user"),
        use("a1", "t1"),
        result("r1", "t1"),
        said("a2"),
      ])
    ).toBe("a2");
  });

  it("stops before the parent's own unanswered call", () => {
    expect(
      cutPoint([
        said("u1", "user"),
        use("a1", "t1"),
        result("r1", "t1"),
        use("a2", "fork"),
      ])
    ).toBe("r1");
  });

  it("keeps earlier steps of the same turn", () => {
    expect(
      cutPoint([
        use("a1", "t1"),
        result("r1", "t1"),
        use("a2", "t2"),
        result("r2", "t2"),
        use("a3", "fork"),
      ])
    ).toBe("r2");
  });

  it("holds back while parallel calls are half answered", () => {
    const parallel: TranscriptEntry = {
      type: "assistant",
      uuid: "a1",
      message: {
        content: [
          { type: "tool_use", id: "x" },
          { type: "tool_use", id: "y" },
        ],
      },
    };
    expect(cutPoint([said("u0", "user"), parallel, result("r1", "x")])).toBe(
      "u0"
    );
  });

  it("ignores a subagent's own entries", () => {
    const sub: TranscriptEntry = {
      ...use("s1", "inner"),
      parent_tool_use_id: "t9",
    };
    expect(cutPoint([said("u1", "user"), sub])).toBe("u1");
  });

  it("is null when there is nothing safe to keep", () => {
    expect(cutPoint([use("a1", "fork")])).toBeNull();
    expect(cutPoint([])).toBeNull();
  });
});
