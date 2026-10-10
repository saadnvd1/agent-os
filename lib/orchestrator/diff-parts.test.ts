import { describe, expect, it } from "vitest";
import { diffParts, fileSections } from "./diff-parts";
import { combineVerdicts } from "./review-prompt";

const file = (name: string, size: number) =>
  `diff --git a/${name} b/${name}\n+${"x".repeat(size)}\n`;

describe("diffParts", () => {
  it("packs whole files, in order, into parts under the cap", () => {
    const diff = file("a/1", 40) + file("a/2", 40) + file("b/1", 40);
    expect(fileSections(diff)).toHaveLength(3);
    const parts = diffParts(diff, 140, 6)!;
    expect(parts).toHaveLength(2);
    expect(parts[0]).toBe(file("a/1", 40) + file("a/2", 40));
    expect(parts[1]).toBe(file("b/1", 40));
    expect(parts.join("")).toBe(diff);
  });

  it("refuses a file bigger than the cap, or too many parts", () => {
    expect(diffParts(file("a", 200), 120, 6)).toBeNull();
    expect(diffParts(file("a", 90) + file("b", 90), 120, 1)).toBeNull();
  });
});

describe("combineVerdicts", () => {
  it("blocks when any part blocks, its findings first", () => {
    const v = combineVerdicts([
      { status: "pass", detail: "fine" },
      { status: "block", detail: "- [blocking]: bad" },
    ]);
    expect(v.status).toBe("block");
    expect(v.detail.split("\n")[0]).toBe("Part 2 of 2: block.");
  });

  it("passes only when every part does, and never on no parts", () => {
    const pass = { status: "pass" as const, detail: "" };
    expect(combineVerdicts([pass, pass]).status).toBe("pass");
    expect(combineVerdicts([]).status).toBe("block");
  });
});
