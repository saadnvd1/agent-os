import { describe, expect, it } from "vitest";
import type { ChatItem } from "@/lib/chat/events";
import { itemMapper, clipBytes, stateOf } from "./frames";

const key = ["gh", "p_", "d".repeat(36)].join("");
const ctx = { home: "/Users/someone", user: "someone", secrets: [], hosts: [] };
const map = itemMapper(ctx);
const base = { createdAt: 5 };
const item = (i: Record<string, unknown>) =>
  ({ ...base, ...i }) as unknown as ChatItem;

describe("what a guest can see", () => {
  it.each([
    ["reasoning", { id: "r", kind: "reasoning", text: "thinking hard" }],
    ["command output", { id: "c", kind: "command_output", text: "$ ls" }],
    [
      "an approval",
      { id: "p", kind: "approval", tool: "Bash", input: { command: "rm" } },
    ],
    ["an mcp list", { id: "m", kind: "mcp", servers: [] }],
    ["a task", { id: "t", kind: "task", description: "d", status: "done" }],
    ["a turn end", { id: "e", kind: "turn_end" }],
  ])("never sends %s", (_n, i) => {
    expect(map(item(i))).toBeNull();
  });

  it("sends a tool as a one-line summary, never its input or output", () => {
    const f = map(
      item({
        id: "t1",
        kind: "tool",
        name: "Bash",
        title: "Ran rspec",
        input: { command: `curl -H "Authorization: ${key}"` },
        output: "secret output",
        status: "done",
      })
    );
    expect(f).toEqual({
      id: "t1",
      kind: "tool",
      name: "Bash",
      summary: "Ran rspec",
      status: "done",
      at: 5,
    });
    expect(JSON.stringify(f)).not.toContain(key);
    expect(JSON.stringify(f)).not.toContain("secret output");
  });

  it("redacts a secret in a tool title and shows only the name for a secret file", () => {
    const f = map(
      item({
        id: "t2",
        kind: "tool",
        name: "Read",
        title: `Read /Users/someone/.ssh/id_ed25519`,
        input: { file_path: "/Users/someone/.ssh/id_ed25519" },
        status: "running",
      })
    );
    expect(f).toMatchObject({ kind: "tool", summary: "Read" });
    const g = map(
      item({
        id: "t3",
        kind: "tool",
        name: "Bash",
        title: `echo ${key}`,
        input: {},
        status: "error",
      })
    );
    expect(JSON.stringify(g)).not.toContain(key);
    expect(g).toMatchObject({ status: "error" });
  });

  it("redacts the whole text, so a secret split across deltas is caught", () => {
    const text = "token is " + key + " ok";
    // What the publisher passes once the deltas have been joined.
    const f = map(item({ id: "a1", kind: "assistant", text: "tok" }), text);
    expect(JSON.stringify(f)).not.toContain(key);
  });

  it("redacts the home path in the reader's text", () => {
    const f = map(
      item({ id: "u", kind: "user", text: "look at /Users/someone/app" })
    );
    expect(JSON.stringify(f)).not.toContain("/Users/someone");
  });

  it("sends the reader's words and a sent suggestion, not machine messages", () => {
    expect(map(item({ id: "u1", kind: "user", text: "hi" }))).toMatchObject({
      kind: "user",
      from: "host",
    });
    expect(
      map(
        item({
          id: "u2",
          kind: "user",
          text: "try this",
          origin: { kind: "guest", label: "Ahmed" },
        })
      )
    ).toMatchObject({ from: "guest:Ahmed" });
    for (const origin of [
      { kind: "peer", label: "other" },
      { kind: "event", label: "AgentOS" },
      { kind: "schedule", label: "s" },
    ])
      expect(
        map(item({ id: "u3", kind: "user", text: "x", origin }))
      ).toBeNull();
    expect(
      map(item({ id: "u4", kind: "user", text: "x", from: "peer-session" }))
    ).toBeNull();
  });

  it("turns todos and plans into short notes", () => {
    expect(
      map(
        item({
          id: "d",
          kind: "todos",
          todos: [
            { text: "a", status: "completed" },
            { text: "b", status: "pending" },
          ],
        })
      )
    ).toMatchObject({ kind: "note", text: "To do: 1 of 2 done" });
    const plan = map(item({ id: "pl", kind: "plan", plan: "Step 1\nStep 2" }));
    expect(plan).toMatchObject({ kind: "note", text: "Step 1 Step 2" });
  });

  it("caps text by bytes, on a character", () => {
    const f = map(
      item({ id: "a", kind: "assistant", text: "é".repeat(30_000) })
    );
    expect(Buffer.byteLength((f as { text: string }).text)).toBeLessThanOrEqual(
      24 * 1024
    );
    expect(clipBytes("日本語", 4)).toBe("日");
  });

  it("maps chat states", () => {
    expect(stateOf("running")).toBe("working");
    expect(stateOf("waiting")).toBe("waiting_on_host");
    expect(stateOf("idle")).toBe("idle");
    expect(stateOf("error")).toBe("idle");
  });
});
