import { describe, expect, it } from "vitest";
import { codeReviewRefusal, parseCodeReview } from "./code-review";

const HEAD = "4f2a9c1e0b7d3a5c6e8f9a0b1c2d3e4f5a6b7c8d";

describe("parseCodeReview", () => {
  it("reads the reviewed commit from the section, in any of the usual spellings", () => {
    for (const line of [
      "Reviewed: 4f2a9c1",
      "**Reviewed:** `4f2a9c1e0b`",
      "- Reviewed commit: 4F2A9C1",
      "Reviewed at: 4f2a9c1",
    ]) {
      const body = `## What changed\n\nStuff\n\n## Code review\n\n${line}\nAgents: review-security\n`;
      expect(parseCodeReview(body)).toEqual({
        sha: line.includes("0b") ? "4f2a9c1e0b" : "4f2a9c1",
      });
    }
  });

  it("is null without the section, and has no sha when the section doesn't name one", () => {
    expect(parseCodeReview(undefined)).toBeNull();
    expect(parseCodeReview("## Summary\n\nReviewed: 4f2a9c1")).toBeNull();
    expect(parseCodeReview("### Code review\n\nAll good")).toEqual({
      sha: null,
    });
  });

  it("only reads the sha inside the section, not a later one", () => {
    const body =
      "## Code review\n\nAgents: none\n\n## Notes\n\nReviewed: 4f2a9c1";
    expect(parseCodeReview(body)).toEqual({ sha: null });
  });
});

describe("codeReviewRefusal", () => {
  it("passes a review of the head commit", () => {
    expect(codeReviewRefusal({ sha: "4f2a9c1" }, HEAD)).toBeNull();
  });

  it("fails closed on an unread body, an unknown head, no section or no sha", () => {
    expect(codeReviewRefusal(undefined, HEAD)).toMatch(/couldn't be read/);
    expect(codeReviewRefusal({ sha: "4f2a9c1" }, undefined)).toMatch(
      /head commit is unknown/
    );
    expect(codeReviewRefusal(null, HEAD)).toMatch(/no Code review section/);
    expect(codeReviewRefusal({ sha: null }, HEAD)).toMatch(
      /doesn't name the reviewed commit/
    );
  });

  it("refuses a review of another commit, unless AgentOS restacked it", () => {
    expect(codeReviewRefusal({ sha: "1234567" }, HEAD)).toMatch(
      /covers 1234567, not its head 4f2a9c1/
    );
    expect(
      codeReviewRefusal({ sha: "1234567" }, HEAD, { restacked: true })
    ).toBeNull();
    expect(codeReviewRefusal(null, HEAD, { restacked: true })).toMatch(
      /no Code review/
    );
  });
});
