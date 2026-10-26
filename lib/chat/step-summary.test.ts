import { describe, expect, it } from "vitest";
import type { ToolItem } from "./group";
import { failedSteps, stepSummary } from "./step-summary";

const tool = (id: string, over: Partial<ToolItem> = {}): ToolItem => ({
  id,
  kind: "tool",
  name: "Read",
  title: `step ${id}`,
  input: {},
  status: "done",
  createdAt: 0,
  ...over,
});
const edit = (id: string, path: string) =>
  tool(id, {
    name: "Edit",
    input: { file_path: path },
    diff: { path, before: "", after: "x" },
  });

describe("stepSummary", () => {
  it("counts steps alone", () => {
    expect(stepSummary([tool("a")])).toBe("1 step");
  });

  it("names edited files and counts commands", () => {
    const tools = [
      edit("a", "/r/src/sources.ts"),
      edit("b", "/r/lib/x.ts"),
      edit("c", "/r/lib/x.ts"),
      tool("d", { name: "Bash" }),
      tool("e", { name: "Bash" }),
    ];
    expect(stepSummary(tools)).toBe(
      "5 steps · edited sources.ts, x.ts · ran 2 commands"
    );
  });

  it("falls back to an edit count when the path is unknown", () => {
    expect(stepSummary([tool("a", { hasDiff: true, deferred: true })])).toBe(
      "1 step · 1 edit"
    );
  });

  it("truncates a long file list", () => {
    const tools = ["a", "b", "c", "d", "e"].map((n) => edit(n, `/r/${n}.ts`));
    expect(stepSummary(tools)).toBe("5 steps · edited a.ts, b.ts, c.ts +2");
  });
});

describe("failedSteps", () => {
  it("is empty when all passed", () => {
    expect(failedSteps([tool("a")])).toEqual({ names: [], more: 0 });
  });

  it("lists failures and caps them", () => {
    const tools = ["a", "b", "c", "d", "e"].map((n) =>
      tool(n, { status: "error" })
    );
    expect(failedSteps([tool("ok"), ...tools])).toEqual({
      names: ["step a", "step b", "step c"],
      more: 2,
    });
  });

  it("ignores running and stopped steps", () => {
    expect(
      failedSteps([
        tool("a", { status: "stopped" }),
        tool("b", { status: "running" }),
      ])
    ).toEqual({ names: [], more: 0 });
  });
});
