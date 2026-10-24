import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ToolItem } from "@/lib/chat/group";
import { ToolGroup } from "./Tools";

const tool = (over: Partial<ToolItem>): ToolItem => ({
  id: "t1",
  kind: "tool",
  name: "Bash",
  title: "npm test",
  input: { command: "npm test" },
  status: "running",
  createdAt: Date.now(),
  ...over,
});

const html = (t: ToolItem) =>
  renderToStaticMarkup(createElement(ToolGroup, { tools: [t] }));

describe("a running step", () => {
  it("shows its output so far without being opened", () => {
    const out = html(tool({ output: "PASS a.test.ts\nRUNS b.test.ts" }));
    expect(out).toContain('data-testid="tool-output"');
    expect(out).toContain("RUNS b.test.ts");
  });

  it("shows no output block before it prints anything", () => {
    expect(html(tool({}))).not.toContain("tool-output");
  });

  it("keeps a finished step collapsed", () => {
    const out = html(tool({ status: "done", output: "ok" }));
    expect(out).not.toContain("tool-output");
  });
});
