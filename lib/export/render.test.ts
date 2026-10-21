import { describe, expect, it } from "vitest";
import { buildDoc } from "./build";
import { renderHtml } from "./html";
import { JSON_SCHEMA, renderJson } from "./json";
import { renderMarkdown } from "./markdown";
import { selectTurns, type ExportInfo } from "./summary";
import { ctx, item, twoTurns } from "./fixtures";

const meta = { name: "My chat", agent: "claude", createdAt: 0 };
const info = (mode: "full" | "compact"): ExportInfo => ({
  mode,
  redact: "all",
  generatedAt: "2026-10-21T20:00:00.000Z",
});
const sel = (
  mode: "full" | "compact",
  items = twoTurns(),
  range?: Parameters<typeof selectTurns>[1]
) => selectTurns(buildDoc({ items, meta, mode, redact: "all", ctx }), range);

describe("markdown", () => {
  const md = renderMarkdown(sel("compact"), info("compact"));

  it("has the header, how-to-read and notes, then turns in order", () => {
    expect(md).toMatch(/^# My chat/);
    expect(md).toContain("## How to read this");
    expect(md).toContain("## Export notes");
    expect(md.indexOf("## Turn 1")).toBeLessThan(md.indexOf("## Turn 2"));
    expect(md).toContain("- Range: Whole session, 2 turns");
  });

  it("labels each cut inline and in the notes", () => {
    expect(md).toContain(
      "[truncated: showing first 10 and last 20 of 100 lines; 70 lines omitted (Compact export)]"
    );
    expect(md).toContain("[omitted: 1 thinking block (Compact export)]");
    expect(md).toContain("- Omitted: 1 thinking block");
    expect(md).toContain("- Truncated: 1 tool output");
  });

  it("fences survive backticks in output", () => {
    const items = [
      item({ kind: "user", text: "go" }),
      item({
        kind: "tool",
        name: "Bash",
        title: "b",
        status: "done",
        input: {},
        output: "```\ncode\n```",
      }),
    ];
    const out = renderMarkdown(sel("full", items), info("full"));
    expect(out).toContain("````\n```\ncode\n```\n````");
  });

  it("notes a range", () => {
    const out = renderMarkdown(
      sel("compact", twoTurns(), { from: 2, to: 2 }),
      info("compact")
    );
    expect(out).toContain("Turns 2–2 of 2");
    expect(out).not.toContain("## Turn 1");
  });
});

describe("json", () => {
  it("parses, with the schema, per-item truncation and totals", () => {
    const j = JSON.parse(renderJson(sel("compact"), info("compact")));
    expect(j.schema).toBe(JSON_SCHEMA);
    expect(j.omissions).toEqual({ "thinking block": 1 });
    expect(j.truncations).toEqual({ "tool output": 1 });
    const tool = j.turns[0].items.find(
      (i: { kind: string }) => i.kind === "tool"
    );
    expect(tool.truncated[0]).toMatchObject({
      field: "output",
      totalLines: 100,
      keptLines: 31,
    });
    expect(j.turns[0].startedAt).toMatch(
      /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d[+-]\d\d:\d\d$/
    );
  });

  it("indents full and not compact", () => {
    expect(renderJson(sel("full"), info("full"))).toContain('\n  "schema"');
    expect(
      renderJson(sel("compact"), info("compact")).trim().split("\n")
    ).toHaveLength(1);
  });
});

describe("html", () => {
  it("escapes, has no script, and shows the badges", () => {
    const items = [
      item({ kind: "user", text: "<script>alert(1)</script>" }),
      item({
        kind: "tool",
        name: "Bash",
        title: "b",
        status: "done",
        input: { command: "x" },
        output: Array.from({ length: 80 }, (_, i) => `l${i}`).join("\n"),
      }),
    ];
    const out = renderHtml(sel("compact", items), info("compact"));
    expect(out).not.toContain("<script");
    expect(out).toContain("&lt;script&gt;");
    expect(out).toContain('class="omit"');
    expect(out).toContain("output truncated");
    expect(out).toContain("<details");
  });
});
