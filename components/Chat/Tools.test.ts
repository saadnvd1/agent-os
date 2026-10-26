import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ToolItem } from "@/lib/chat/group";
import { ToolGroup } from "./Tools";

const tool = (id: string, over: Partial<ToolItem> = {}): ToolItem => ({
  id,
  kind: "tool",
  name: "Bash",
  title: `check ${id}`,
  input: {},
  status: "done",
  createdAt: 0,
  ...over,
});

const render = (tools: ToolItem[]) =>
  renderToStaticMarkup(createElement(ToolGroup, { tools }));

describe("collapsed ToolGroup", () => {
  it("names the failed steps and counts the rest", () => {
    const html = render([
      tool("a", { output: "HTTP/2 200 \n" }),
      tool("b", { status: "error", output: "Exit code 7" }),
      tool("c", { status: "error", deferred: true, outcome: "HTTP 404" }),
      tool("d", { status: "stopped" }),
    ]);
    expect(html).toContain("4 steps");
    expect(html).toContain("1 ok");
    expect(html).toContain("2 failed");
    expect(html).toContain("1 not run");
    expect(html).toContain("✕ check b");
    expect(html).toContain("✕ check c");
    expect(html).not.toContain("check a");
  });

  it("has no outcome row when every step passed", () => {
    const html = render([tool("a"), tool("b")]);
    expect(html).toContain("2 steps · ran 2 commands");
    expect(html).not.toContain("Show steps");
  });

  it("shows no outcome row while a step runs", () => {
    expect(render([tool("a", { status: "running" })])).not.toContain(
      "Show steps"
    );
  });
});
