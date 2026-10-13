import { describe, expect, it } from "vitest";
import { cleanOutputs, outputsText, parseResult } from "./result";

describe("parseResult", () => {
  it("reads status, outputs and the sentence", () => {
    expect(
      parseResult(
        "done\nRESULT: ok build=143 version=1.4.2 — TestFlight has it"
      )
    ).toEqual({
      ok: true,
      outputs: { build: "143", version: "1.4.2" },
      summary: "TestFlight has it",
    });
  });

  it("takes the last line, through a bullet marker", () => {
    const r = parseResult(
      "RESULT: ok build=1\n● RESULT: failed — no signing key"
    );
    expect(r?.ok).toBe(false);
    expect(r?.summary).toBe("no signing key");
  });

  it("finds nothing without a line", () => {
    expect(parseResult("all good")).toBeNull();
    expect(parseResult(null)).toBeNull();
    expect(parseResult("RESULT: maybe")).toBeNull();
  });

  it("drops keys and values that could carry instructions", () => {
    const r = parseResult(
      "RESULT: ok Bad=1 note=a;b build=1;rm good_key=ok/1.2"
    );
    expect(r?.outputs).toEqual({ good_key: "ok/1.2" });
  });

  it("keeps at most 8 pairs and clips the sentence", () => {
    const pairs = Array.from({ length: 12 }, (_, i) => `k${i}=${i}`).join(" ");
    const r = parseResult(`RESULT: ok ${pairs} — ${"x".repeat(500)}`);
    expect(Object.keys(r!.outputs)).toHaveLength(8);
    expect(r!.summary.length).toBeLessThanOrEqual(300);
  });
});

describe("cleanOutputs", () => {
  it("accepts numbers and refuses objects", () => {
    expect(cleanOutputs({ build: 7, bad: { a: 1 } })).toEqual({ build: "7" });
    expect(cleanOutputs(null)).toEqual({});
  });
  it("renders facts on one line", () => {
    expect(outputsText({ a: "1", b: "2" })).toBe("a=1 b=2");
    expect(outputsText(null)).toBe("");
  });
});
