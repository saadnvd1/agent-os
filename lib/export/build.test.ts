import { describe, expect, it } from "vitest";
import { buildDoc } from "./build";
import { COMPACT } from "./compact";
import { ctx, item, lines, SECRET, twoTurns } from "./fixtures";
import { visible } from "../share/snapshot";

const meta = { name: "My chat", agent: "claude", createdAt: 0 };
const build = (
  items = twoTurns(),
  mode: "full" | "compact" = "compact",
  redact: "all" | "secrets" = "all"
) => buildDoc({ items, meta, mode, redact, ctx });
const flat = (d: ReturnType<typeof build>) => JSON.stringify(d.turns);

describe("buildDoc", () => {
  it("keeps chronological order and numbers the turns", () => {
    const d = build();
    expect(d.turns.map((t) => t.n)).toEqual([1, 2]);
    const times = d.turns.flatMap((t) => t.items.map((i) => i.at));
    expect([...times].sort()).toEqual(times);
    expect(d.turns[0].durationMs).toBe(4000);
    expect(d.turns[0].costUsd).toBe(0.5);
  });

  it("redacts every string, with the invented machine's details", () => {
    const out = flat(build(twoTurns(), "full"));
    expect(out).not.toContain(SECRET);
    expect(out).not.toContain(ctx.home);
    expect(out).not.toContain("fake-mac.local");
    expect(out).toContain("[secret]");
  });

  it("with redaction on secrets only, keeps paths but still masks a token", () => {
    const d = build(twoTurns(), "full", "secrets");
    const out = flat(d);
    expect(out).toContain(ctx.home);
    expect(out).not.toContain(SECRET);
    expect(d.turns[0].hits.secret).toBe(1);
    expect(d.turns[0].hits.path).toBe(0);
  });

  it("hides the output of a secret file and its patch", () => {
    const d = build(
      [
        item({ kind: "user", text: "read it" }),
        item({
          kind: "tool",
          name: "Read",
          title: "Read",
          status: "done",
          input: { file_path: "/work/.env" },
          output: "KEY=abc",
          diff: { path: "/work/.env", before: "A=1", after: "A=2" },
        }),
      ],
      "full"
    );
    const tool = d.turns[0].items[1];
    expect(tool.output).toBe("[contents of a secret file hidden]");
    expect(tool.diff?.patch).toBe("[contents of a secret file hidden]");
  });

  describe("compact", () => {
    it("drops thinking and counts it", () => {
      const d = build();
      expect(d.turns[0].items.some((i) => i.kind === "thinking")).toBe(false);
      expect(d.turns[0].omitted["thinking block"]).toBe(1);
      expect(
        build(twoTurns(), "full").turns[0].items.some(
          (i) => i.kind === "thinking"
        )
      ).toBe(true);
    });

    it("keeps exactly the first 10 and last 20 lines of long output", () => {
      const tool = build().turns[0].items.find((i) => i.kind === "tool")!;
      const out = tool.output!.split("\n");
      expect(out).toHaveLength(COMPACT.outputHead + 1 + COMPACT.outputTail);
      expect(out[0]).toBe("line 1");
      expect(out[9]).toBe("line 10");
      expect(out[10]).toBe(
        "[truncated: showing first 10 and last 20 of 100 lines; 70 lines omitted (Compact export)]"
      );
      expect(out[out.length - 1]).toBe("line 100");
      expect(tool.truncated?.[0]).toMatchObject({
        field: "output",
        totalLines: 100,
        keptChars: expect.any(Number),
      });
    });

    it("keeps an error's tail", () => {
      const d = build([
        item({ kind: "user", text: "go" }),
        item({
          kind: "tool",
          name: "Bash",
          title: "x",
          input: { command: "x" },
          status: "error",
          output: lines(100),
        }),
      ]);
      const out = d.turns[0].items[1].output!;
      expect(out).toContain("line 100");
      expect(out).toContain("line 74");
      expect(out).not.toContain("line 5\n");
    });

    it("clips long tool input, and keeps a command longer", () => {
      const d = build([
        item({ kind: "user", text: "go" }),
        item({
          kind: "tool",
          name: "Edit",
          title: "e",
          status: "done",
          input: { x: "y".repeat(2000) },
        }),
        item({
          kind: "tool",
          name: "Bash",
          title: "b",
          status: "done",
          input: { command: "z".repeat(900) },
        }),
      ]);
      const [, edit, bash] = d.turns[0].items;
      expect(edit.input).toContain("[truncated: showing first 300 of");
      expect(bash.input).toBe("z".repeat(900));
    });

    it("reduces a diff to counts, and full keeps the patch", () => {
      const change = item({
        kind: "tool",
        name: "Edit",
        title: "e",
        status: "done",
        input: {},
        diff: { path: "a.ts", before: "a\nb\nc", after: "a\nB\nc\nd" },
      });
      const items = [item({ kind: "user", text: "go" }), change];
      const compact = build(items).turns[0].items[1];
      expect(compact.diff).toEqual({ path: "a.ts", added: 2, removed: 1 });
      expect(build(items, "full").turns[0].items[1].diff?.patch).toContain(
        "-b"
      );
    });

    it("keeps only the last to-do list of a turn", () => {
      const todo = (s: string) =>
        item({ kind: "todos", todos: [{ text: s, status: "pending" }] });
      const d = build([
        item({ kind: "user", text: "go" }),
        todo("one"),
        todo("two"),
      ]);
      expect(d.turns[0].items.filter((i) => i.kind === "todos")).toHaveLength(
        1
      );
      expect(d.turns[0].omitted["to-do list"]).toBe(1);
    });

    it("cuts a huge paste to its start and end, labelled", () => {
      const d = build([item({ kind: "user", text: "p".repeat(20_000) })]);
      const u = d.turns[0].items[0];
      expect(u.text).toContain(
        "[truncated: showing first 4000 and last 2000 of 20000 characters"
      );
      expect(d.turns[0].truncated["user message"]).toBe(1);
    });
  });

  it("caps one runaway field in full mode, labelled", () => {
    const d = build(
      [
        item({ kind: "user", text: "go" }),
        item({ kind: "command_output", text: "x".repeat(250_000) }),
      ],
      "full"
    );
    const c = d.turns[0].items[1];
    expect(c.text).toContain("200,000-character field cap");
    expect(c.text!.length).toBeLessThan(201_000);
  });

  it("counts what is always left out, and every cut has its marker", () => {
    const d = build([
      item({ kind: "user", text: "go" }),
      item({ kind: "note", text: "n", tone: "note" }),
      item({
        kind: "approval",
        toolName: "x",
        title: "x",
        input: {},
        canAlways: false,
        status: "allowed",
      }),
      item({ kind: "mcp", servers: [] }),
      ...twoTurns().slice(2, 3),
    ]);
    expect(d.turns[0].omitted).toMatchObject({
      "orchestrator note": 1,
      approval: 1,
      "MCP listing": 1,
    });
    for (const t of build().turns)
      for (const i of t.items)
        if (i.truncated?.length)
          expect(`${i.input}${i.output}${i.text}`).toContain("[truncated:");
  });

  it("drops what an undo took back", () => {
    const u2 = item({ kind: "user", text: "second" });
    const items = visible([
      item({ kind: "user", text: "first" }),
      u2,
      item({ kind: "undo", from: u2.id, filesChanged: 0 }),
    ]);
    expect(build(items).turns).toHaveLength(1);
  });

  it("labels a message sent while the agent was working", () => {
    const d = build([
      item({ kind: "user", text: "a", midTurn: false }),
      item({ kind: "user", text: "b", midTurn: true }),
    ]);
    expect(d.turns).toHaveLength(1);
    expect(d.turns[0].items[1].note).toBe("sent while the agent was working");
  });
});
