import { describe, expect, it } from "vitest";
import { codeRefusal, displayCode, generateCode, normalizeCode } from "./code";

describe("access codes", () => {
  it("generates six digits, padded", () => {
    for (let i = 0; i < 200; i++) expect(generateCode()).toMatch(/^\d{6}$/);
  });
  it("shows a padded code with its dash", () => {
    expect(displayCode("000123")).toBe("000-123");
    expect(displayCode("482917")).toBe("482-917");
    expect(displayCode("BLUE42")).toBe("BLUE42");
  });
  it("normalizes like Connect", () => {
    expect(normalizeCode(" 482-917 ")).toBe("482917");
    expect(normalizeCode("blue 42-x")).toBe("BLUE42X");
  });
  it("refuses codes Connect would refuse", () => {
    expect(codeRefusal("12345")).not.toBeNull();
    expect(codeRefusal("a".repeat(33))).not.toBeNull();
    expect(codeRefusal("ab_cdef")).not.toBeNull();
    expect(codeRefusal("482-917")).toBeNull();
    expect(codeRefusal("blue42")).toBeNull();
  });
});
