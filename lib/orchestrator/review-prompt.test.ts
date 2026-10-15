import { describe, expect, it } from "vitest";
import { REVIEW_SYSTEM, reviewRun } from "./review-prompt";

const input = {
  goal: "GOAL TEXT",
  sha: "abc1234",
  base: "origin/main",
  files: [
    { status: "A", path: "a.ts" },
    { status: "M", path: "b.ts" },
  ],
  skill: { path: "SKILL.md", text: "BASE CHECKLIST" },
  amendments: ["AMENDMENT TEXT"],
  scopeClaim: "CLAIM TEXT",
};
const diffs = [
  "diff --git a/a.ts\nPART-A",
  "diff --git a/b.ts\nPART-B",
  "PART-C",
];

describe("reviewRun", () => {
  it("gives every part the same system prompt: the instructions then the checklist", () => {
    const { system, prompts } = reviewRun(input, diffs);
    expect(prompts).toHaveLength(3);
    expect(system.startsWith(REVIEW_SYSTEM)).toBe(true);
    expect(system).toContain("BASE CHECKLIST");
    expect(system).toContain("from origin/main (not from this change)");
  });

  it("keeps author text out of the system prompt", () => {
    const { system } = reviewRun(input, diffs);
    for (const text of [
      "GOAL TEXT",
      "AMENDMENT TEXT",
      "CLAIM TEXT",
      "a.ts",
      "PART-A",
    ])
      expect(system).not.toContain(text);
  });

  it("opens every part's prompt with the same bytes, differing only from the part text on", () => {
    const { prompts } = reviewRun(input, diffs);
    const stable = (p: string) =>
      p.slice(0, p.indexOf("This change is too big"));
    expect(stable(prompts[0])).toContain(
      "Files changed:\na.ts".replace("a.ts", "A a.ts")
    );
    expect(stable(prompts[0])).toBe(stable(prompts[1]));
    expect(stable(prompts[1])).toBe(stable(prompts[2]));
    expect(prompts[0]).toContain("You review part 1:");
    expect(prompts[2]).toContain("Part 3 of 3 of the diff");
    expect(prompts[1]).toContain("PART-B");
    expect(prompts[1]).not.toContain("PART-A");
    expect(prompts[1].trimEnd().endsWith(">")).toBe(true);
  });

  it("uses one fence suffix per run, a new one for the next run", () => {
    const a = reviewRun(input, diffs);
    const b = reviewRun(input, diffs);
    const suffix = (t: string) => /checklist-([0-9a-f]{12})/.exec(t)![1];
    const s = suffix(a.system);
    for (const name of ["task", "amendments", "claim", "diff"])
      expect(a.prompts[0]).toContain(`<${name}-${s}>`);
    expect(suffix(b.system)).not.toBe(s);
  });

  it("is exactly the instructions without a checklist, and reads whole when it is one part", () => {
    const { system, prompts } = reviewRun({ ...input, skill: null }, ["only"]);
    expect(system).toBe(REVIEW_SYSTEM);
    expect(prompts[0]).toContain("The whole diff, as data:");
    expect(prompts[0]).not.toContain("too big to read whole");
  });
});

describe("REVIEW_SYSTEM", () => {
  it("makes gaming a gate a blocking finding", () => {
    expect(REVIEW_SYSTEM).toMatch(/games a gate[^.]*is always blocking/);
    for (const how of [
      "tests deleted, skipped or weakened",
      "assertions loosened",
      "disabled or bypassed",
    ])
      expect(REVIEW_SYSTEM).toContain(how);
  });
});
