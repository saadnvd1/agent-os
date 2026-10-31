import { describe, it, expect } from "vitest";
import { buildTaskBrief } from "./brief";

describe("buildTaskBrief", () => {
  const brief = buildTaskBrief({ branch: "feature/x", baseBranch: "main" });

  it("ends in a PR and forbids merging", () => {
    expect(brief).toContain("git push -u origin feature/x");
    expect(brief).toContain("gh pr create");
    expect(brief).toMatch(/Never merge/);
  });

  it("leaves the review to AgentOS and asks for no review section", () => {
    expect(brief).toMatch(/AgentOS runs an independent review/);
    expect(brief).not.toContain("## Code review");
    expect(brief).not.toMatch(/Reviewed:/);
  });

  it("asks for the What's New line at the end of the PR body", () => {
    expect(brief).toContain("Whats-new: New|Improved|Fixed");
    expect(brief).toContain("Whats-new: skip");
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

describe("the checks line", () => {
  it("tells the agent to run the declared test command and leave the full suite to CI", () => {
    const brief = buildTaskBrief({
      branch: "feature/x",
      baseBranch: "main",
      test: "npx vitest run <the test files you touched>",
    });
    expect(brief).toContain(
      "Run exactly this to check your work: `npx vitest run <the test files you touched>`"
    );
    expect(brief).toMatch(/CI runs the full suite/);
    expect(brief).not.toContain("Run the project's own checks");
  });

  it("keeps the general sentence when the project declares no test", () => {
    const brief = buildTaskBrief({ branch: "feature/x", baseBranch: "main" });
    expect(brief).toContain(
      "Run the project's own checks (typecheck, tests, lint) when they exist"
    );
    expect(brief).not.toMatch(/CI runs the full suite/);
  });
});

describe("the UI check section", () => {
  const base = { branch: "feature/x", baseBranch: "main" };

  it("is absent unless the project has a UI", () => {
    expect(buildTaskBrief(base)).not.toContain("Checking UI changes");
    expect(buildTaskBrief({ ...base, ui: null })).not.toContain(
      "chrome-devtools"
    );
  });

  it("is added for a web project, after the standing rules", () => {
    const brief = buildTaskBrief({ ...base, ui: "web" });
    expect(brief).toContain("## Checking UI changes");
    expect(brief).toContain("**Browser check**");
    expect(brief.indexOf("Checking UI changes")).toBeGreaterThan(
      brief.indexOf("BLOCKED:")
    );
  });

  it("uses the project's viewports", () => {
    const brief = buildTaskBrief({
      ...base,
      ui: "web",
      browse: { viewports: ["1024x768"] },
    });
    expect(brief).toContain("1024x768");
    expect(brief).not.toContain("390x844");
  });
});
