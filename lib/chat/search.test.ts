import { randomUUID } from "crypto";
import { describe, expect, it } from "vitest";
import type { ChatItem } from "./events";
import { readPage } from "./page";

const { saveItem } = await import("./store");
const { searchChat, MAX_MATCHES, SEARCH_PAGE } = await import("./search");

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

  it("pages older results from a cursor, counting them all on the first", () => {
    const id = chat(
      Array.from({ length: 7 }, (_, i) => say(`a${i}`, `match ${i}`))
    );
    const first = searchChat(id, "match", null, 3);
    expect(first.total).toBe(7);
    expect(first.hits.map((h) => h.id)).toEqual(["a6", "a5", "a4"]);
    expect(first.hasMore).toBe(true);
    const second = searchChat(id, "match", first.cursor, 3);
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

  it("stops counting at the cap, and every match past it is still reachable", () => {
    const per = 100;
    const rows = MAX_MATCHES / per + 5;
    const id = chat(
      Array.from({ length: rows }, (_, i) => say(`a${i}`, "ab ".repeat(per)))
    );
    let page = searchChat(id, "ab", null, 10);
    expect(page.capped).toBe(true);
    expect(page.total).toBe(MAX_MATCHES);
    const seen = page.hits.map((h) => h.id);
    while (page.hasMore) {
      page = searchChat(id, "ab", page.cursor, 10);
      seen.push(...page.hits.map((h) => h.id));
    }
    expect(seen).toHaveLength(rows);
    expect(new Set(seen).size).toBe(rows);
  });

  it("reads a huge conversation a slice at a time, missing nothing", () => {
    const big = "x".repeat(1000);
    const id = chat(
      Array.from({ length: 40 }, (_, i) =>
        say(`a${i}`, i % 10 === 0 ? `Néedle ${big}` : `filler ${big}`)
      )
    );
    // Outside ASCII the SQL can't narrow the rows: the budget must.
    const budget = 5_000;
    let page = searchChat(id, "néedle", null, SEARCH_PAGE, budget);
    expect(page.capped).toBe(true);
    expect(page.hasMore).toBe(true);
    const seen = page.hits.map((h) => h.id);
    for (let i = 0; page.hasMore && i < 50; i++) {
      page = searchChat(id, "néedle", page.cursor, SEARCH_PAGE, budget);
      seen.push(...page.hits.map((h) => h.id));
    }
    expect(page.hasMore).toBe(false);
    expect(seen).toEqual(["a30", "a20", "a10", "a0"]);
  });

  it("finds a tool's input as its row shows it, pretty-printed", () => {
    const id = chat([
      {
        id: "t1",
        kind: "tool",
        name: "Read",
        title: "Read x",
        input: { file_path: "/x" },
        status: "done",
        createdAt: 1,
      },
    ]);
    expect(searchChat(id, '"file_path": "/x"').hits.map((h) => h.id)).toEqual([
      "t1",
    ]);
  });

  it("finds a match in an edit's diff, and none in one it isn't in", () => {
    const id = chat([
      {
        id: "e1",
        kind: "tool",
        name: "Edit",
        title: "Edit a.ts",
        input: {},
        diff: { path: "a.ts", before: "const a = 1;", after: "const b = 2;" },
        status: "done",
        createdAt: 1,
      },
    ]);
    expect(searchChat(id, "b = 2").total).toBe(1);
    expect(searchChat(id, "zzz").total).toBe(0);
  });
});
