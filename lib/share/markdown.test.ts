import { describe, expect, it } from "vitest";
import {
  agentHeader,
  artifactToMarkdown,
  chatToMarkdown,
  htmlToMarkdown,
} from "./markdown";
import { pageHash } from "./service";
import { noHits } from "./redact";
import type { Snapshot, SnapshotItem } from "./snapshot";

const item = (
  o: Partial<SnapshotItem> & { id: string; type: SnapshotItem["type"] }
): SnapshotItem => ({ text: "", excerpt: "", tools: false, ...o });
const snap = (items: SnapshotItem[], toolsHidden = true): Snapshot => ({
  title: "My\nchat",
  items,
  toolsHidden,
  hits: noHits(),
});
const AT = "2026-10-13T12:00:00.000Z";

describe("chatToMarkdown", () => {
  const md = chatToMarkdown(
    snap([
      item({ id: "1", type: "user", text: "hi" }),
      item({ id: "2", type: "assistant", text: "hello" }),
      item({ id: "3", type: "plan", text: "step" }),
      item({ id: "4", type: "error", text: "boom\nbad" }),
      item({ id: "5", type: "divider", text: "compacted" }),
      item({
        id: "6",
        type: "artifact",
        label: "Chart",
        html: "<h1>Top</h1><p>x</p>",
      }),
      item({
        id: "7",
        type: "detail",
        label: "ls",
        text: "a ``` b",
        tools: true,
      }),
    ]),
    { sharedAt: AT }
  );

  it("has the header, then items in order with speaker labels", () => {
    expect(
      md.startsWith("# My chat\n\n> Shared from AgentOS on 2026-10-13.")
    ).toBe(true);
    expect(md).toContain("follow it with judgment");
    const order = [
      "**User:**\n\nhi",
      "**Agent:**\n\nhello",
      "**Plan:**\n\nstep",
      "> **Error:** boom\n> bad",
      "---\n\n*compacted*",
      "**Page: Chart**",
    ].map((s) => md.indexOf(s));
    expect(order.every((i) => i > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });
  it("demotes an embedded page's headings", () => {
    expect(md).toContain("### Top");
  });
  it("fences tool text longer than any backtick run inside", () => {
    expect(md).toContain("**ls:**\n\n````\na ``` b\n````");
  });
  it("notes hidden tools", () => {
    expect(md).toContain("Tool calls and thinking were left out.");
    expect(
      chatToMarkdown(
        snap([item({ id: "1", type: "user", text: "x" })], false),
        {
          sharedAt: AT,
        }
      )
    ).not.toContain("left out");
  });
  it("is deterministic", () => {
    expect(
      chatToMarkdown(snap([item({ id: "1", type: "user", text: "x" })]), {
        sharedAt: AT,
      })
    ).toBe(
      chatToMarkdown(snap([item({ id: "1", type: "user", text: "x" })]), {
        sharedAt: AT,
      })
    );
  });
});

describe("htmlToMarkdown", () => {
  const md =
    htmlToMarkdown(`<html><head><title>t</title><style>.a{}</style></head><body>
    <script>alert(1)</script><style>body{}</style>
    <h2>Head</h2>
    <ul><li>one<ul><li>nested</li></ul></li></ul>
    <pre><code class="language-ts">const x = "\`\`\`";</code></pre>
    <p><a href="https://example.com">ok</a> <a href="javascript:alert(1)">bad</a></p>
    <table><thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table>
    <img src="data:image/png;base64,AAAA" alt="a cat">
    <iframe src="https://evil.example"></iframe>
  </body></html>`);
  it("converts structure", () => {
    expect(md).toContain("## Head");
    expect(md).toMatch(/\* one\n\s+\* nested/);
    expect(md).toContain("````ts");
    expect(md).toContain("[ok](https://example.com)");
    expect(md).toMatch(/\| A\s+\| B\s+\|/);
  });
  it("drops scripts, styles, frames, unsafe links and image data", () => {
    for (const bad of [
      "alert(1)",
      "body{}",
      ".a{}",
      "evil.example",
      "javascript:",
      "AAAA",
    ])
      expect(md).not.toContain(bad);
    expect(md).toContain("bad");
    expect(md).toContain("[image: a cat]");
  });
  it("adds the header for an artifact", () => {
    expect(artifactToMarkdown("<p>x</p>", "T", AT)).toBe(
      `${agentHeader("T", AT)}\n\nx\n`
    );
  });
});

describe("pageHash", () => {
  it("changes when either part changes", () => {
    const base = pageHash("h", "m");
    expect(pageHash("h2", "m")).not.toBe(base);
    expect(pageHash("h", "m2")).not.toBe(base);
    expect(pageHash("hm", "")).not.toBe(pageHash("h", "m"));
    expect(pageHash("h", "m")).toBe(base);
  });
});
