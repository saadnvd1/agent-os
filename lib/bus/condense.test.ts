import { describe, expect, it } from "vitest";
import type { ChatItem } from "@/lib/chat/events";
import { condenseItems, grepTurns, renderTurns, toolLine } from "./condense";

let n = 0;
const base = () => ({ id: `i${++n}`, createdAt: n });
const user = (text: string): ChatItem => ({ ...base(), kind: "user", text });
const said = (text: string): ChatItem => ({
  ...base(),
  kind: "assistant",
  text,
});
const tool = (
  name: string,
  input: unknown,
  output = "",
  status: "done" | "error" = "done"
): ChatItem => ({
  ...base(),
  kind: "tool",
  name,
  title: name,
  input,
  status,
  output,
});

describe("condense", () => {
  it("turns each tool call into one line with its key argument", () => {
    const lines = [
      tool("Bash", { command: "npm test\nsecond line" }),
      tool("Read", { file_path: "/repo/src/a.ts" }),
      tool("Grep", { pattern: "foo", path: "lib" }),
      tool("WebSearch", { query: "vitest mock" }),
      tool("mcp__agentos__read", { session: "x" }),
      tool("Edit", { file_path: "/repo/b.ts" }, "", "error"),
    ].map((t) => toolLine(t as never));
    expect(lines).toEqual([
      "· Bash npm test",
      "· Read /repo/src/a.ts",
      "· Grep foo in lib",
      "· WebSearch vitest mock",
      "· agentos: read",
      "· Edit /repo/b.ts (failed)",
    ]);
  });

  it("keeps prompts and replies in full and drops tool results", () => {
    const secret = `${"AWS_SECRET_ACCESS_KEY"}=${"wJalr" + "X".repeat(30)}`;
    const text = condenseItems([
      user("fix the bug\nplease"),
      tool("Bash", { command: "env" }, secret),
      tool("Bash", { command: "tv get box" }, "gh" + "p_" + "A".repeat(36)),
      { ...base(), kind: "command_output", text: "a\nb\nc" },
      said("done.\nAll good."),
    ])
      .flatMap((t) => t.lines)
      .join("\n");
    expect(text).toContain("[user] fix the bug\nplease");
    expect(text).toContain("[assistant] done.\nAll good.");
    expect(text).toContain("· Bash env");
    expect(text).toContain("[command output: 3 lines left out]");
    expect(text).not.toContain("wJalr");
    expect(text).not.toContain("ghp_");
  });

  const chat = () =>
    condenseItems(
      Array.from({ length: 10 }, (_, i) => [
        user(`question ${i + 1}`),
        said(`answer ${i + 1}`),
      ]).flat()
    );

  it("shows the last 4 turns by default and any number asked", () => {
    expect(renderTurns(chat(), {})).toMatchObject({ from: 7, to: 10 });
    expect(renderTurns(chat(), { turns: 2 })).toMatchObject({ from: 9 });
    const all = renderTurns(chat(), { all: true });
    expect(all).toMatchObject({ from: 1, to: 10, truncated: false });
  });

  it("limits by lines", () => {
    const r = renderTurns(chat(), { lines: 3 });
    expect(r.text.split("\n")).toEqual([
      "[assistant] answer 9",
      "[user] question 10",
      "[assistant] answer 10",
    ]);
    expect(r.truncated).toBe(true);
  });

  it("stays within the cap, dropping the oldest, unless asked for all", () => {
    const big = condenseItems(
      Array.from({ length: 4 }, (_, i) => [
        user(`q${i}`),
        said("x".repeat(3000)),
      ]).flat()
    );
    const r = renderTurns(big, { cap: 7000 });
    expect(r.text.length).toBeLessThanOrEqual(7000);
    expect(r.from).toBeGreaterThan(1);
    expect(r.truncated).toBe(true);
    expect(
      renderTurns(big, { cap: 7000, all: true }).text.length
    ).toBeGreaterThan(12000);
  });

  it("greps with two lines of context under their turn", () => {
    const turns = condenseItems([
      user("one"),
      said("a"),
      said("b"),
      said("c needle d"),
      said("e"),
      said("f"),
      said("g"),
      user("two"),
      said("nothing"),
    ]);
    const r = grepTurns(turns, "NEEDLE");
    expect(r.text).toBe(
      [
        "── turn 1 ──",
        "[assistant] a",
        "[assistant] b",
        "[assistant] c needle d",
        "[assistant] e",
        "[assistant] f",
      ].join("\n")
    );
    expect(grepTurns(turns, "absent").text).toBe("");
  });
});
