import { describe, expect, it } from "vitest";
import { decodeOutput, LineSplitter, parseControlLine } from "./control-parse";

describe("control mode lines", () => {
  it("decodes a pane's output: octal escapes and backslashes", () => {
    expect(
      parseControlLine("%output %2 \\033]7501;working\\033\\134hi\\015\\012")
    ).toEqual({
      type: "output",
      pane: "%2",
      data: "\x1b]7501;working\x1b\\hi\r\n",
    });
    expect(decodeOutput("a\\\\b")).toBe("a\\b");
  });

  it("keeps raw UTF-8 bytes as they came", () => {
    const line = Buffer.from("%output %1 ⠋ x\\012", "utf8").toString("latin1");
    const out = parseControlLine(line);
    expect(
      out.type === "output" && Buffer.from(out.data, "latin1").toString("utf8")
    ).toBe("⠋ x\n");
  });

  it("reads exits, session and layout changes, and command blocks", () => {
    expect(parseControlLine("%exit")).toEqual({ type: "exit", reason: "" });
    expect(parseControlLine("%exit server exited")).toEqual({
      type: "exit",
      reason: "server exited",
    });
    expect(parseControlLine("%sessions-changed")).toEqual({
      type: "sessions-changed",
    });
    expect(
      parseControlLine("%layout-change @1 b25d,80x24,0,0,1 b25d,80x24,0,0,1 *")
    ).toEqual({
      type: "layout-change",
    });
    expect(parseControlLine("%begin 1 2 0")).toEqual({
      type: "begin",
      id: "1 2",
      ours: false,
    });
    expect(parseControlLine("%begin 1 2 1")).toMatchObject({ ours: true });
    expect(parseControlLine("%error 1 2 1")).toEqual({
      type: "end",
      id: "1 2",
      error: true,
    });
    expect(parseControlLine("%end text a pane printed").type).toBe("other");
    expect(parseControlLine("%window-pane-changed @1 %3").type).toBe(
      "pane-changed"
    );
    expect(parseControlLine("%session-window-changed $0 @2").type).toBe(
      "pane-changed"
    );
    expect(parseControlLine("%window-renamed @1 x").type).toBe("other");
    expect(parseControlLine("%output %3").type).toBe("other");
  });
});

describe("LineSplitter", () => {
  it("joins lines across chunks", () => {
    const s = new LineSplitter();
    expect(s.push(Buffer.from("%out"))).toEqual([]);
    expect(s.push(Buffer.from("put %1 a\n%exit\r\n%beg"))).toEqual([
      "%output %1 a",
      "%exit",
    ]);
    expect(s.push(Buffer.from("in 1 2 0\n"))).toEqual(["%begin 1 2 0"]);
  });

  it("drops a line that grows past its limit instead of holding it", () => {
    const s = new LineSplitter(10);
    expect(s.push(Buffer.from("x".repeat(20)))).toEqual([]);
    expect(s.push(Buffer.from("tail\n%exit\n"))).toEqual(["%exit"]);
  });
});
