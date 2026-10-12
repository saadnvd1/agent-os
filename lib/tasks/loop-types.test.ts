import { describe, expect, it } from "vitest";
import { combineVerdicts, toVerdict } from "../orchestrator/review-prompt";
import {
  REVIEW_DETAIL_MAX,
  REVIEW_FINDINGS_MAX,
  parseReviewDetail,
} from "./loop-types";

describe("parseReviewDetail", () => {
  it("reads back what the review gate stores", () => {
    const { detail } = toVerdict({
      verdict: "block",
      summary: "Not safe yet.",
      findings: [
        {
          severity: "blocking",
          file: "lib/a.ts",
          line: 12,
          summary: "bad: thing",
        },
        { severity: "note", summary: "no file" },
        { severity: "major", file: "b.ts", summary: "no line" },
      ],
    });
    expect(parseReviewDetail(detail)).toEqual({
      summary: "Not safe yet.",
      findings: [
        {
          severity: "blocking",
          file: "lib/a.ts",
          line: 12,
          summary: "bad: thing",
        },
        { severity: "note", file: null, line: null, summary: "no file" },
        { severity: "major", file: "b.ts", line: null, summary: "no line" },
      ],
      truncated: false,
    });
  });

  it("keeps part headers of a multi-part review in the summary", () => {
    const { detail } = combineVerdicts([
      toVerdict({ verdict: "pass", summary: "ok" }),
      toVerdict({
        verdict: "block",
        summary: "no",
        findings: [
          { severity: "blocking", file: "x.ts", line: 1, summary: "s" },
        ],
      }),
    ]);
    const parsed = parseReviewDetail(detail);
    expect(parsed.summary).toContain("Part 1 of 2: pass.");
    expect(parsed.findings).toHaveLength(1);
  });

  it("caps the text and the findings, and says so", () => {
    const many = Array.from(
      { length: REVIEW_FINDINGS_MAX + 5 },
      (_, i) => `- [note]: f${i}`
    );
    const a = parseReviewDetail(many.join("\n"));
    expect(a.findings).toHaveLength(REVIEW_FINDINGS_MAX);
    expect(a.truncated).toBe(true);
    const b = parseReviewDetail("x".repeat(REVIEW_DETAIL_MAX + 10));
    expect(b.summary.length).toBe(REVIEW_DETAIL_MAX);
    expect(b.truncated).toBe(true);
  });

  it("leaves script-looking text as plain text and handles empty", () => {
    const p = parseReviewDetail(
      "<script>alert(1)</script>\n- [blocking] a.ts:1: $(rm -rf /)"
    );
    expect(p.summary).toBe("<script>alert(1)</script>");
    expect(p.findings[0].summary).toBe("$(rm -rf /)");
    expect(parseReviewDetail(null)).toEqual({
      summary: "",
      findings: [],
      truncated: false,
    });
  });
});
