import { describe, it, expect } from "vitest";
import { buildTaskBrief } from "./brief";

describe("buildTaskBrief", () => {
  const brief = buildTaskBrief({ branch: "feature/x", baseBranch: "main" });

  it("ends in a PR and forbids merging", () => {
    expect(brief).toContain("git push -u origin feature/x");
    expect(brief).toContain("gh pr create");
    expect(brief).toMatch(/Never merge/);
  });

  it("defines the blocked signal the state detector looks for", () => {
    expect(brief).toContain('"BLOCKED:"');
  });
});
