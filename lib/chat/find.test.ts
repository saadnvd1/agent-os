import { describe, expect, it } from "vitest";
import type { ChatItem } from "./events";
import {
  findableText,
  flattenHits,
  joinPage,
  nextHits,
  locate,
  occurrences,
  snippetAt,
  stepIndex,
  type SearchResult,
} from "./find";

const at = 1;
const user = (id: string, text = "q"): ChatItem => ({
  id,
  kind: "user",
  text,
  tagged: true,
  createdAt: at,
});
const say = (id: string, text = "a"): ChatItem => ({
  id,
  kind: "assistant",
  text,
  createdAt: at,
});
const tool = (id: string, name = "Read"): ChatItem => ({
  id,
  kind: "tool",
  name,
  title: `${name} ${id}`,
  input: { file: id },
  status: "done",
  createdAt: at,
});

describe("locate", () => {
  it("opens the folded run and the step a match is in", () => {
    const items = [user("u1"), tool("t1"), tool("t2"), say("a1")];
    expect(locate(items, "t2")).toEqual({
      block: "t1",
      open: ["steps:t1", "tool:t2"],
    });
  });

  it("scrolls to a plain message with nothing to open", () => {
    expect(locate([user("u1"), say("a1")], "a1")).toEqual({
      block: "a1",
      open: [],
    });
  });

  it("opens an undone block, then the step inside it", () => {
    const items: ChatItem[] = [
      user("u1"),
      tool("t1"),
      say("a1"),
      { id: "x1", kind: "undo", from: "u1", filesChanged: 0, createdAt: at },
    ];
    expect(locate(items, "t1")).toEqual({
      block: "x1",
      open: ["undone:x1", "steps:t1", "tool:t1"],
    });
  });

  it("opens reasoning, a subagent's card and an event row", () => {
    const items: ChatItem[] = [
      { id: "r1", kind: "reasoning", text: "hm", createdAt: at },
      tool("g1", "Agent"),
      {
        id: "e1",
        kind: "user",
        text: "x",
        origin: { kind: "event", label: "AgentOS", body: "PR merged" },
        tagged: true,
        createdAt: at,
      },
    ];
    expect(locate(items, "r1")?.open).toEqual(["reasoning:r1"]);
    expect(locate(items, "g1")?.open).toEqual(["agent:g1"]);
    expect(locate(items, "e1")?.open).toEqual(["event:e1"]);
  });

  it("finds reasoning folded between steps in the run around it", () => {
    const items: ChatItem[] = [
      tool("t1"),
      { id: "r1", kind: "reasoning", text: "hm", createdAt: at },
      tool("t2"),
    ];
    expect(locate(items, "r1")).toEqual({ block: "t1", open: ["steps:t1"] });
  });

  it("is null for an item not loaded yet", () => {
    expect(locate([say("a1")], "old")).toBeNull();
  });
});

describe("findableText", () => {
  it("is a tool's title, command and output", () => {
    const t: ChatItem = {
      id: "t",
      kind: "tool",
      name: "Bash",
      title: "List",
      input: { command: "ls -la" },
      output: "total 0",
      status: "done",
      createdAt: at,
    };
    expect(findableText(t)).toBe("List\nls -la\ntotal 0");
  });

  it("is nothing for a settled approval the timeline hides", () => {
    const a: ChatItem = {
      id: "p",
      kind: "approval",
      toolName: "Bash",
      title: "Run rm",
      input: {},
      canAlways: true,
      status: "allowed",
      createdAt: at,
    };
    expect(findableText(a)).toBe("");
    expect(findableText({ ...a, status: "pending" })).toBe("Run rm");
  });
});

describe("matching", () => {
  it("counts case-insensitive matches that don't overlap", () => {
    expect(occurrences("aaaa AA", "aa")).toEqual([0, 2, 5]);
  });

  it("cuts a one-line snippet around a match", () => {
    const text = "x".repeat(100) + "needle\nhere" + "y".repeat(100);
    const s = snippetAt(text, 100, 6, 5);
    expect(s).toEqual({ before: "…xxxxx", match: "needle", after: " here…" });
  });
});

describe("walking results", () => {
  it("goes newest first, an item's last match before its first", () => {
    expect(
      flattenHits([
        {
          id: "a3",
          seq: 3,
          count: 2,
          snippet: { before: "", match: "", after: "" },
        },
        {
          id: "a1",
          seq: 1,
          count: 1,
          snippet: { before: "", match: "", after: "" },
        },
      ])
    ).toEqual([
      { id: "a3", n: 1 },
      { id: "a3", n: 0 },
      { id: "a1", n: 0 },
    ]);
  });

  it("steps, asks for more past the loaded page, and wraps once all are in", () => {
    expect(stepIndex(0, 1, 3, false)).toBe(1);
    expect(stepIndex(2, 1, 3, true)).toBe("more");
    expect(stepIndex(2, 1, 3, false)).toBe(0);
    expect(stepIndex(0, -1, 3, false)).toBe(2);
    expect(stepIndex(0, -1, 3, true)).toBe(0);
    expect(stepIndex(0, 1, 0, false)).toBe(0);
  });
});

describe("paging past budget-sliced pages", () => {
  const hit = (id: string, seq: number) => ({
    id,
    seq,
    count: 1,
    snippet: { before: "", match: "x", after: "" },
  });
  const page = (p: Partial<SearchResult>): SearchResult => ({
    total: 0,
    capped: false,
    hits: [],
    cursor: null,
    hasMore: false,
    ...p,
  });

  it("asks on from each cursor until a page has a hit", async () => {
    const pages = [
      page({ hasMore: true, cursor: 9 }),
      page({ hasMore: true, cursor: 5 }),
      page({ hits: [hit("a1", 2)], cursor: 2 }),
    ];
    const asked: (number | undefined)[] = [];
    const got = await nextHits(
      async (_q, before) => {
        asked.push(before);
        return pages.shift()!;
      },
      "q",
      12
    );
    expect(asked).toEqual([12, 9, 5]);
    expect(got?.hits.map((h) => h.id)).toEqual(["a1"]);
  });

  it("gives up after its page limit", async () => {
    let calls = 0;
    const got = await nextHits(
      async () => (calls++, page({ hasMore: true, cursor: 1 })),
      "q",
      null,
      4
    );
    expect(calls).toBe(4);
    expect(got?.hits).toEqual([]);
  });

  it("keeps the first page's count and takes the last page's cursor", () => {
    const first = {
      query: "q",
      ...page({
        total: 7,
        capped: true,
        hits: [hit("a9", 9)],
        hasMore: true,
        cursor: 9,
      }),
    };
    const joined = joinPage(
      first,
      page({ total: 0, hits: [hit("a3", 3)], cursor: 3 })
    );
    expect(joined).toMatchObject({
      total: 7,
      capped: true,
      hasMore: false,
      cursor: 3,
    });
    expect(joined.hits.map((h) => h.id)).toEqual(["a9", "a3"]);
  });
});

describe("findableText of an edit", () => {
  const edit: ChatItem = {
    id: "e",
    kind: "tool",
    name: "Edit",
    title: "Edit a.ts",
    input: {},
    diff: { path: "src/a.ts", before: "const a = 1;", after: "const b = 2;" },
    status: "done",
    createdAt: at,
  };

  it("lays the diff out only when the query can be in it, in any case", () => {
    expect(findableText(edit, "zzz")).toBe("Edit a.ts\nsrc/a.ts");
    expect(findableText(edit, "B = 2")).toContain("const b = 2;");
    expect(findableText(edit)).toContain("const a = 1;");
  });
});
