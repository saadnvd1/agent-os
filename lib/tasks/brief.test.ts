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

describe("a stacked brief", () => {
  const brief = buildTaskBrief({
    branch: "feature/child",
    baseBranch: "feature/parent",
    stack: { pr: 41, name: "ENG-7", also: ["ENG-5"] },
  });

  it("targets the parent's branch and says what it is stacked on", () => {
    expect(brief).toContain("gh pr create --base feature/parent");
    expect(brief).toContain('"Stacked on #41 (ENG-7)"');
  });

  it("says the parent's work is not its own and names other blockers", () => {
    expect(brief).toMatch(/are not yours/);
    expect(brief).toContain("ENG-5, whose work is NOT in your base");
  });

  it("is unchanged for a task on the default branch", () => {
    expect(buildTaskBrief({ branch: "b", baseBranch: "main" })).not.toContain(
      "STACKED"
    );
  });
});
