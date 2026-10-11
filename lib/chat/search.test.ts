import { randomUUID } from "crypto";
import { describe, expect, it } from "vitest";
import type { ChatItem } from "./events";
import { readPage } from "./page";

const { saveItem } = await import("./store");
const { searchChat, MAX_MATCHES } = await import("./search");

const say = (id: string, text: string): ChatItem => ({
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

describe("searchChat", () => {
  it("finds every match case-insensitively, newest item first", () => {
    const id = chat([
      say("a1", "Deploy the box"),
      say("a2", "nothing here"),
      say("a3", "deploy, then DEPLOY again"),
    ]);
    const r = searchChat(id, "deploy");
    expect(r.total).toBe(3);
    expect(r.hits.map((h) => [h.id, h.count])).toEqual([
      ["a3", 2],
      ["a1", 1],
    ]);
    expect(r.hits[0].snippet.match).toBe("deploy");
    expect(r.hasMore).toBe(false);
  });

  it("finds tool input and output a page sends without them, in a folded run", () => {
    const tool: ChatItem = {
      id: "t1",
      kind: "tool",
      name: "Bash",
      title: "Run tests",
      input: { command: "npm test -- --grep widget" },
      output: "FAIL widget.test.ts\nexpected 3 got 4",
      status: "error",
      createdAt: 1,
    };
    const id = chat([tool, say("a1", "done")]);
    // What the browser gets has no output to search.
    expect(readPage(id).items[0]).not.toHaveProperty("output");
    expect(searchChat(id, "--grep").hits.map((h) => h.id)).toEqual(["t1"]);
    const out = searchChat(id, "expected 3");
    expect(out.hits.map((h) => h.id)).toEqual(["t1"]);
    expect(out.hits[0].snippet).toMatchObject({ match: "expected 3" });
    // The title and the output both say widget.
    expect(searchChat(id, "widget").total).toBe(2);
  });

  it("finds items on pages the reader hasn't loaded", () => {
    const items = Array.from({ length: 200 }, (_, i) =>
      say(`a${i}`, i === 3 ? "the needle is old" : `filler ${i}`)
    );
    const id = chat(items);
    expect(readPage(id).items.some((i) => i.id === "a3")).toBe(false);
    const r = searchChat(id, "needle");
    expect(r.hits).toMatchObject([{ id: "a3" }]);
    expect(r.hits[0].seq).toBeLessThan(readPage(id).cursor!);
  });

  it("finds event rows by what they show, not the text the agent got", () => {
    const id = chat([
      {
        id: "u1",
        kind: "user",
        text: "[AgentOS] PR #12 merged. Reply with aos send.",
        origin: { kind: "event", label: "AgentOS", body: "PR #12 merged" },
        tagged: true,
        createdAt: 1,
      },
    ]);
    expect(searchChat(id, "#12 merged").total).toBe(1);
    expect(searchChat(id, "aos send").total).toBe(0);
  });

  it("skips what the timeline never shows", () => {
    const id = chat([
      {
        id: "k1",
        kind: "task",
        taskId: "x",
        description: "secret background",
        status: "running",
        createdAt: 1,
      },
      say("a1", "visible background"),
    ]);
    expect(searchChat(id, "background").hits.map((h) => h.id)).toEqual(["a1"]);
  });

  it("pages older results from a cursor and counts them all every time", () => {
    const id = chat(
      Array.from({ length: 7 }, (_, i) => say(`a${i}`, `match ${i}`))
    );
    const first = searchChat(id, "match", null, 3);
    expect(first.total).toBe(7);
    expect(first.hits.map((h) => h.id)).toEqual(["a6", "a5", "a4"]);
    expect(first.hasMore).toBe(true);
    const second = searchChat(id, "match", first.cursor, 3);
    expect(second.total).toBe(7);
    expect(second.hits.map((h) => h.id)).toEqual(["a3", "a2", "a1"]);
    const last = searchChat(id, "match", second.cursor, 3);
    expect(last.hits.map((h) => h.id)).toEqual(["a0"]);
    expect(last.hasMore).toBe(false);
  });

  it("matches quotes, backslashes and LIKE wildcards literally", () => {
    const id = chat([
      say("a1", 'set "x" to C:\\tmp at 100%'),
      say("a2", "100 percent, x_y"),
    ]);
    expect(searchChat(id, '"x"').hits.map((h) => h.id)).toEqual(["a1"]);
    expect(searchChat(id, "C:\\tmp").hits.map((h) => h.id)).toEqual(["a1"]);
    expect(searchChat(id, "0%").hits.map((h) => h.id)).toEqual(["a1"]);
    expect(searchChat(id, "x_y").hits.map((h) => h.id)).toEqual(["a2"]);
    expect(searchChat(id, "%").total).toBe(0); // under MIN_QUERY
  });

  it("folds case outside ASCII too", () => {
    const id = chat([say("a1", "Ünïcode café")]);
    expect(searchChat(id, "ünïcode CAFÉ").total).toBe(1);
  });

  it("only ever searches its own conversation", () => {
    const mine = chat([say("a1", "shared word")]);
    chat([say("b1", "shared word")]);
    expect(searchChat(mine, "shared word").hits.map((h) => h.id)).toEqual([
      "a1",
    ]);
  });

  it("stops counting at the cap and says so", () => {
    const id = chat([say("a1", "ab ".repeat(MAX_MATCHES + 10))]);
    const r = searchChat(id, "ab");
    expect(r.capped).toBe(true);
    expect(r.total).toBeGreaterThanOrEqual(MAX_MATCHES);
  });
});
