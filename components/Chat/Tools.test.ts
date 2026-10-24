import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ToolItem } from "@/lib/chat/group";
import { MAX_CHIPS } from "./StepOutcomes";
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
  it("keeps each step's outcome in view", () => {
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
    expect(html).toContain("check a: ok, HTTP 200");
    expect(html).toContain("check b: failed, exit 7");
    expect(html).toContain("check c: failed, HTTP 404");
    expect(html).toContain("check d: not run");
  });

  it("shows no strip while a step runs", () => {
    expect(render([tool("a", { status: "running" })])).not.toContain(
      "Show steps"
    );
  });

  it("caps the strip", () => {
    const tools = Array.from({ length: MAX_CHIPS + 3 }, (_, i) =>
      tool(`x${i}`)
    );
    expect(render(tools)).toContain("+3 more");
  });
});
