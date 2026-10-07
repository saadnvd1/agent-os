import { describe, expect, it } from "vitest";
import { LIMITS, OscScanner, parseReport } from "./parse";

const b64 = (s: string) => Buffer.from(s, "utf-8").toString("base64");
const ST = "\x1b\\";
const BEL = "\x07";
const osc = (body: string, end = ST) => `\x1b]7501;${body}${end}`;

describe("parseReport", () => {
  it("reads a blocked report with its kind, app and message", () => {
    expect(
      parseReport(
        `state=blocked:kind=permission:app=test:msg=${b64("Apply 3 changes?")}`
      )
    ).toEqual({
      state: "blocked",
      id: "",
      kind: "permission",
      app: "test",
      msg: "Apply 3 changes?",
    });
  });

  it("discards a report without a known state", () => {
    expect(parseReport("kind=permission")).toBeNull();
    expect(parseReport("state=sleeping")).toBeNull();
  });

  it("skips malformed pairs and ignores unknown keys", () => {
    expect(parseReport("junk:state=working:=x:future=1:Bad=1")).toEqual({
      state: "working",
      id: "",
    });
  });

  it("lets a repeated key's last value win", () => {
    expect(parseReport("state=idle:state=done")?.state).toBe("done");
  });

  it("keeps kind only on blocked, progress only on working or blocked", () => {
    expect(parseReport("state=working:kind=question:progress=40")).toEqual({
      state: "working",
      id: "",
      progress: 40,
    });
    expect(parseReport("state=done:progress=40")).toEqual({
      state: "done",
      id: "",
    });
    expect(parseReport("state=working:progress=101")?.progress).toBeUndefined();
    expect(parseReport("state=blocked:kind=nope")?.kind).toBeUndefined();
  });

  it("accepts base64 with or without padding", () => {
    const padded = b64("hi"); // "aGk="
    expect(parseReport(`state=done:msg=${padded}`)?.msg).toBe("hi");
    expect(
      parseReport(`state=done:msg=${padded.replace(/=+$/, "")}`)?.msg
    ).toBe("hi");
  });

  it("drops a message that isn't base64 or UTF-8, keeping the report", () => {
    expect(parseReport("state=done:msg=a")).toEqual({ state: "done", id: "" });
    expect(
      parseReport(
        `state=done:msg=${Buffer.from([0xff, 0xfe]).toString("base64")}`
      )
    ).toEqual({
      state: "done",
      id: "",
    });
  });

  it("refuses a report whose message carries a control character", () => {
    expect(parseReport(`state=done:msg=${b64("ok\x1b[2J")}`)).toBeNull();
    expect(parseReport(`state=done:msg=${b64("line\nbreak")}`)).toBeNull();
    expect(parseReport(`state=done:title=${b64("a\u0085b")}`)).toBeNull();
  });

  it("discards a report that breaks a size limit", () => {
    const long = b64("x".repeat(LIMITS.msgDecoded + 1));
    expect(parseReport(`state=done:msg=${long}`)).toBeNull();
    expect(parseReport(`state=done:app=${"a".repeat(33)}`)).toBeNull();
    expect(parseReport(`state=done:${"k".repeat(17)}=1`)).toBeNull();
    expect(
      parseReport(`state=done:msg=${b64("x".repeat(LIMITS.msgDecoded))}`)?.msg
    ).toHaveLength(LIMITS.msgDecoded);
  });

  it("reads hierarchical ids and ignores bad ones", () => {
    expect(parseReport("state=working:id=deploy/us-east.1")?.id).toBe(
      "deploy/us-east.1"
    );
    expect(parseReport("state=working:id=a//b")).toBeNull();
    expect(parseReport(`state=working:id=${"a".repeat(33)}`)).toBeNull();
    expect(
      parseReport(`state=working:id=${Array(9).fill("a").join("/")}`)
    ).toBeNull();
  });

  it("reads clear, with and without an id", () => {
    expect(parseReport("state=clear")).toEqual({ state: "clear", id: "" });
    expect(parseReport("state=clear:id=a/b:msg=eA")).toEqual({
      state: "clear",
      id: "a/b",
    });
  });
});

describe("OscScanner", () => {
  it("finds reports ended by ST or BEL among other output", () => {
    const events = new OscScanner().push(
      `hello ${osc("state=working")} world ${osc("state=done", BEL)}\r\n`
    );
    expect(events).toEqual([
      { type: "report", report: { state: "working", id: "" } },
      { type: "report", report: { state: "done", id: "" } },
    ]);
  });

  it("joins a sequence split across chunks, at every byte", () => {
    const seq = osc(`state=blocked:kind=question:msg=${b64("Which one?")}`);
    for (let cut = 1; cut < seq.length; cut++) {
      const scanner = new OscScanner();
      const events = [
        ...scanner.push("before" + seq.slice(0, cut)),
        ...scanner.push(seq.slice(cut) + "after"),
      ];
      expect(events, `cut at ${cut}`).toEqual([
        {
          type: "report",
          report: {
            state: "blocked",
            id: "",
            kind: "question",
            msg: "Which one?",
          },
        },
      ]);
    }
  });

  it("ignores other OSCs, even ones split across chunks", () => {
    const scanner = new OscScanner();
    expect(scanner.push("\x1b]0;title")).toEqual([]);
    expect(scanner.push(`${ST}${osc("state=idle")}`)).toEqual([
      { type: "report", report: { state: "idle", id: "" } },
    ]);
  });

  it("drops a sequence over 4096 bytes and recovers after it", () => {
    const scanner = new OscScanner();
    const huge = osc(`state=done:x=${"a".repeat(LIMITS.sequence)}`);
    expect(scanner.push(huge.slice(0, 3000))).toEqual([]);
    expect(scanner.push(huge.slice(3000))).toEqual([]);
    expect(scanner.push(osc("state=working"))).toEqual([
      { type: "report", report: { state: "working", id: "" } },
    ]);
  });

  it("never holds more than one sequence's worth of bytes", () => {
    const scanner = new OscScanner();
    scanner.push("\x1b]7501;state=done:x=" + "a".repeat(10000));
    expect(
      (scanner as unknown as { pending: string }).pending.length
    ).toBeLessThanOrEqual(1);
  });

  it("treats an ESC inside a sequence as cancelling it", () => {
    expect(
      new OscScanner().push(`\x1b]7501;state=done\x1b[0m${osc("state=idle")}`)
    ).toEqual([{ type: "report", report: { state: "idle", id: "" } }]);
  });

  it("reads the feature query and a shell prompt (OSC 133 A)", () => {
    expect(
      new OscScanner().push(`\x1b]7501;?${ST}\x1b]133;A${BEL}\x1b]133;B${BEL}`)
    ).toEqual([{ type: "query" }, { type: "prompt" }]);
  });
});
