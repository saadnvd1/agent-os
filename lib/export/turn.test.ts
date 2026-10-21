import { beforeEach, describe, expect, it } from "vitest";
import { copyTurn } from "./turn";
import { SECRET, ctx, item, lines, resetClock } from "./fixtures";

const meta = { name: "t", agent: "claude", createdAt: 0 };
const run = (items: ReturnType<typeof item>[]) =>
  copyTurn(items, items[0].id, ctx, meta);

beforeEach(resetClock);

describe("copyTurn", () => {
  it("lists reasoning, tools, output and the answer in order, without the prompt", () => {
    const { full, response } = run([
      item({ kind: "user", text: "do it", midTurn: false }),
      item({ kind: "reasoning", text: "thinking hard" }),
      item({
        kind: "tool",
        name: "Bash",
        title: "ls",
        input: { command: "ls" },
        status: "done",
        output: "a.ts",
      }),
      item({ kind: "error", message: "boom" }),
      item({ kind: "assistant", text: "all done" }),
      item({ kind: "turn_end" }),
    ]);
    const at = (s: string) => full.indexOf(s);
    expect(full).not.toContain("do it");
    expect(at("**Thinking**")).toBeGreaterThanOrEqual(0);
    expect(at("thinking hard")).toBeLessThan(at("**Tool · Bash"));
    expect(at("a.ts")).toBeLessThan(at("**Error**"));
    expect(at("**Error**")).toBeLessThan(at("all done"));
    expect(response).toBe("all done");
  });

  it("masks secrets everywhere", () => {
    const { full, response } = run([
      item({ kind: "user", text: "go", midTurn: false }),
      item({
        kind: "tool",
        name: "Bash",
        input: { command: `curl -H "x: ${SECRET}"` },
        status: "done",
        output: `token=${SECRET}`,
      }),
      item({ kind: "assistant", text: `key ${SECRET}` }),
    ]);
    expect(full).not.toContain(SECRET);
    expect(response).not.toContain(SECRET);
    expect(full).toContain("[secret]");
  });

  it("labels cut, missing and running output", () => {
    const { full } = run([
      item({ kind: "user", text: "go", midTurn: false }),
      item({
        kind: "tool",
        name: "Bash",
        input: { command: "big" },
        status: "done",
        output: "x".repeat(250_000),
      }),
      item({ kind: "tool", name: "Read", input: {}, status: "error" }),
      item({ kind: "tool", name: "Grep", input: {}, status: "running" }),
    ]);
    expect(full).toContain("[truncated:");
    expect(full).toContain("[output unavailable]");
    expect(full).toContain("[output unavailable: tool still running]");
  });

  it("keeps code blocks, fencing output that holds fences", () => {
    const code = "```ts\nconst a = 1;\n```";
    const { full, response } = run([
      item({ kind: "user", text: "go", midTurn: false }),
      item({
        kind: "tool",
        name: "Bash",
        input: { command: "cat x" },
        status: "done",
        output: `${code}\n${lines(3)}`,
      }),
      item({ kind: "assistant", text: `Here:\n\n${code}` }),
    ]);
    expect(response).toBe(`Here:\n\n${code}`);
    expect(full).toContain("const a = 1;");
    expect(full).toMatch(/````+\n[\s\S]*```ts/);
  });

  it("rejects an unknown turn", () => {
    expect(() => copyTurn([], "nope", ctx, meta)).toThrow("Turn not found");
  });
});
