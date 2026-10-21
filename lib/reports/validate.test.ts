import { describe, expect, it } from "vitest";
import { validateModelReport } from "./validate";
import { ev } from "./fixtures";

const evidence = [
  ev("ci:unit", "ci", "pass", { label: "CI · unit" }),
  ev("test:1", "test", "fail", {
    label: "vitest run lib/a.test.ts",
    excerpt: "3 failed",
  }),
  ev("ask:7", "ask", "pending", { label: "Waiting on you: pick a name" }),
  ev("state:task", "state", "info", { label: "Task state: working" }),
];
const line = (tone: string, text: string, cites: string[]) => ({
  tone,
  text,
  evidence: cites,
});
const check = (lines: unknown[], extra: object = {}) =>
  validateModelReport({ lines, ...extra }, evidence);

describe("validateModelReport", () => {
  it("keeps a cited line and numbers its evidence contains", () => {
    const v = check([
      line("done", "The unit checks passed.", ["ci:unit"]),
      line("warn", "3 tests are failing.", ["test:1"]),
    ]);
    expect(v.lines.map((l) => l.text)).toHaveLength(2);
    expect(v.dropped).toBe(0);
  });

  it("drops a line with no evidence or an unknown id", () => {
    const v = check([
      line("done", "Looks good.", []),
      line("done", "Fine.", ["ci:nope"]),
    ]);
    expect(v.lines).toHaveLength(0);
    expect(v.dropped).toBe(2);
  });

  it("drops invented numbers and any percent sign", () => {
    const v = check([
      line("done", "42 checks passed.", ["ci:unit"]),
      line("done", "The work is mostly done.", ["ci:unit"]),
      line("done", "Done, 100% sure.", ["ci:unit"]),
    ]);
    expect(v.lines.map((l) => l.text)).toEqual(["The work is mostly done."]);
    expect(v.dropped).toBe(2);
  });

  it("drops a tone its evidence doesn't support", () => {
    const v = check([
      line("done", "Tests are fine.", ["test:1"]),
      line("warn", "Checks are failing.", ["ci:unit"]),
      line("blocked", "Waiting on a decision.", ["ask:7"]),
    ]);
    expect(v.lines.map((l) => l.tone)).toEqual(["blocked"]);
  });

  it("holds the recommendation to the same rules", () => {
    expect(
      check([], {
        recommendation: { text: "Fix it, 90% there.", evidence: ["test:1"] },
      }).recommendation
    ).toBeNull();
    expect(
      check([], {
        recommendation: {
          text: "Fix the failing tests.",
          evidence: ["test:1"],
        },
      }).recommendation
    ).toMatchObject({ evidence: ["test:1"] });
  });

  it("reads acceptance mappings (numbered from 1) and ignores an estimate field", () => {
    const v = validateModelReport(
      {
        lines: [],
        acceptance: [{ item: 1, evidence: ["ci:unit"] }],
        estimate: 65,
        percent: 65,
      },
      evidence
    );
    expect(v.mappings).toEqual([{ item: 0, evidence: ["ci:unit"] }]);
  });
});
