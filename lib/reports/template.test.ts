import { describe, expect, it } from "vitest";
import { templateLines } from "./template";
import { ev } from "./fixtures";

describe("templateLines", () => {
  it("cites evidence in every line and recommends fixing the first failure", () => {
    const evidence = [
      ev("state:task", "state", "fail"),
      ev("ci:unit", "ci", "pass", { label: "CI · unit" }),
      ev("ci:lint", "ci", "fail", { label: "CI · lint" }),
    ];
    const { lines, recommendation } = templateLines("checks-failing", evidence);
    expect(lines.every((l) => l.evidence.length > 0)).toBe(true);
    expect(lines.map((l) => l.tone)).toEqual(["done", "warn", "next"]);
    expect(recommendation?.evidence).toEqual(["ci:lint"]);
    expect(lines.some((l) => /%/.test(l.text))).toBe(false);
  });
});
