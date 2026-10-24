import { describe, expect, it } from "vitest";
import type { ToolItem } from "./group";
import { lighten } from "./page";
import { stepCounts, toolCode, toolOutcome } from "./tool-outcome";

const tool = (over: Partial<ToolItem> = {}): ToolItem => ({
  id: "t",
  kind: "tool",
  name: "Bash",
  title: "curl",
  input: {},
  status: "done",
  createdAt: 0,
  ...over,
});

describe("toolCode", () => {
  it.each([
    ["Exit code 1\nboom", "exit 1"],
    ["out\nCommand exited with code 2", "exit 2"],
    ["HTTP/2 404 \nserver: x", "HTTP 404"],
    ["HTTP/1.1 301 Moved\n\nHTTP/2 200 \n", "HTTP 200"],
    ["all fine", undefined],
    ["", undefined],
  ])("reads %j", (output, want) => expect(toolCode(output)).toBe(want));
});

describe("stepCounts", () => {
  it("counts each status", () => {
    expect(
      stepCounts([
        tool(),
        tool({ status: "error" }),
        tool({ status: "stopped" }),
        tool({ status: "running" }),
      ])
    ).toEqual({ total: 4, ok: 1, failed: 1, stopped: 1, running: 1 });
  });
});

describe("outcome of a deferred step", () => {
  it("survives lighten without the output", () => {
    const light = lighten(tool({ status: "error", output: "Exit code 7" }));
    expect(light).toMatchObject({ deferred: true, outcome: "exit 7" });
    expect(toolOutcome(light as ToolItem)).toBe("exit 7");
  });
});
