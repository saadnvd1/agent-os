import { describe, expect, it } from "vitest";
import { parseAcceptance } from "./acceptance";

describe("parseAcceptance", () => {
  it("reads the checklist under ## Acceptance and stops at the next heading", () => {
    const plan = `# Plan\n\n## Acceptance\n- [ ] One thing works\n- [x] Another\n\n## Pieces\n- [ ] not mine\n`;
    expect(parseAcceptance(plan)).toEqual(["One thing works", "Another"]);
  });
  it("is empty without the section, and skips lines that aren't checklist items", () => {
    expect(parseAcceptance("# Plan\n- [ ] x")).toEqual([]);
    expect(parseAcceptance(null)).toEqual([]);
    expect(
      parseAcceptance("## Acceptance\njust prose\n- plain bullet\n- [ ] ok")
    ).toEqual(["ok"]);
  });
  it("caps the count and the length", () => {
    const many = Array.from({ length: 30 }, (_, i) => `- [ ] item ${i}`).join(
      "\n"
    );
    expect(parseAcceptance(`## Acceptance\n${many}`)).toHaveLength(12);
    expect(
      parseAcceptance(`## Acceptance\n- [ ] ${"x".repeat(500)}`)[0]
    ).toHaveLength(240);
  });
});
