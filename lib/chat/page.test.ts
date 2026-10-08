import { randomUUID } from "crypto";
import { describe, expect, it } from "vitest";
import type { ChatItem } from "./events";

const { saveItem } = await import("./store");
const { readPage, lighten, toolBody } = await import("./page");

const say = (id: string, text = id): ChatItem => ({
  id,
  kind: "assistant",
  text,
  createdAt: 1,
});

function chat(items: ChatItem[]): string {
  const id = randomUUID();
  for (const item of items) saveItem(id, item);
  return id;
}

const ids = (items: ChatItem[]) => items.map((i) => i.id);

describe("readPage", () => {
  it("opens on the latest items and pages back to the first", () => {
    const all = Array.from({ length: 10 }, (_, i) => say(`m${i}`));
    const id = chat(all);
    const first = readPage(id, null, 4);
    expect(ids(first.items)).toEqual(["m6", "m7", "m8", "m9"]);
    expect(first.hasMore).toBe(true);
    const second = readPage(id, first.cursor, 4);
    expect(ids(second.items)).toEqual(["m2", "m3", "m4", "m5"]);
    const last = readPage(id, second.cursor, 4);
    expect(ids(last.items)).toEqual(["m0", "m1"]);
    expect(last.hasMore).toBe(false);
  });

  it("stops at its byte budget but always sends one item", () => {
    const id = chat([say("a", "x".repeat(500)), say("b", "y".repeat(500))]);
    expect(ids(readPage(id, null, 75, 700).items)).toEqual(["b"]);
    expect(ids(readPage(id, null, 75, 10).items)).toEqual(["b"]);
  });

  it("an empty conversation has no cursor and nothing more", () => {
    expect(readPage(randomUUID())).toEqual({
      items: [],
      cursor: null,
      hasMore: false,
    });
  });

  it("brings the messages an undo took back onto its page", () => {
    const id = chat([
      say("m0"),
      { id: "u1", kind: "user", text: "do it", createdAt: 1 },
      say("m2"),
      say("m3"),
      say("m4"),
      { id: "undo", kind: "undo", from: "u1", filesChanged: 0, createdAt: 1 },
      say("m6"),
    ]);
    const page = readPage(id, null, 2);
    expect(ids(page.items)).toEqual(["u1", "m2", "m3", "m4", "undo", "m6"]);
    expect(page.hasMore).toBe(true);
    expect(ids(readPage(id, page.cursor, 2).items)).toEqual(["m0"]);
  });

  it("sends tool calls without their output and diff, which load on open", () => {
    const tool: ChatItem = {
      id: "t1",
      kind: "tool",
      name: "Edit",
      title: "Edit a.ts",
      input: { path: "a.ts" },
      status: "done",
      output: "ok",
      diff: { path: "a.ts", before: "a", after: "b" },
      createdAt: 1,
    };
    const id = chat([tool]);
    const [sent] = readPage(id).items;
    expect(sent).toMatchObject({
      deferred: true,
      hasDiff: true,
      hasOutput: true,
    });
    expect(sent).not.toHaveProperty("output");
    expect(sent).not.toHaveProperty("diff");
    expect(toolBody(id, "t1")).toEqual({ output: "ok", diff: tool.diff });
    expect(toolBody(id, "missing")).toBeNull();
  });
});

describe("lighten", () => {
  it("leaves everything but a tool call with a body as it is", () => {
    const item = say("a");
    expect(lighten(item)).toBe(item);
    const bare: ChatItem = {
      id: "t",
      kind: "tool",
      name: "Read",
      title: "Read",
      input: {},
      status: "running",
      createdAt: 1,
    };
    expect(lighten(bare)).toBe(bare);
  });
});
