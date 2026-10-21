import { describe, expect, it } from "vitest";
import { parseReview } from "./parseReview";

const block = (json: string) =>
  `It works.\n\n\`\`\`agentos-review\n${json}\n\`\`\`\n`;

describe("parseReview", () => {
  it("reads a valid block", () => {
    const got = parseReview(
      block(
        JSON.stringify({
          verdict: "continue",
          summary: "Tests fail on null input.",
          issues: [
            {
              severity: "high",
              title: "Null crash",
              detail: "x",
              where: "a.ts:3",
            },
          ],
          prompt: "Handle null in a.ts and rerun the test.",
        })
      )
    );
    expect(got.ok && got.review.verdict).toBe("continue");
    expect(got.ok && got.review.issues[0].where).toBe("a.ts:3");
  });

  it("takes the last block when there are several", () => {
    const two =
      block(
        JSON.stringify({ verdict: "continue", summary: "first", prompt: "a" })
      ) +
      block(
        JSON.stringify({ verdict: "done", summary: "second", prompt: null })
      );
    const got = parseReview(two);
    expect(got.ok && got.review.summary).toBe("second");
    expect(got.ok && got.review.prompt).toBeNull();
  });

  it("refuses a missing block, bad JSON and too many issues", () => {
    expect(parseReview("No block here").ok).toBe(false);
    const bad = parseReview(block("{verdict: continue"));
    expect(!bad.ok && bad.error).toMatch(/valid JSON/);
    const many = parseReview(
      block(
        JSON.stringify({
          verdict: "continue",
          summary: "s",
          issues: Array.from({ length: 9 }, () => ({
            severity: "low",
            title: "t",
          })),
        })
      )
    );
    expect(!many.ok && many.error).toMatch(/issues/);
    const verdict = parseReview(
      block(JSON.stringify({ verdict: "maybe", summary: "s" }))
    );
    expect(verdict.ok).toBe(false);
  });

  it("allows done with no prompt, and an empty prompt reads as none", () => {
    const got = parseReview(
      block(JSON.stringify({ verdict: "done", summary: "Verified." }))
    );
    expect(got.ok && got.review.prompt).toBeNull();
    const empty = parseReview(
      block(JSON.stringify({ verdict: "continue", summary: "s", prompt: "  " }))
    );
    expect(empty.ok && empty.review.prompt).toBeNull();
  });
});
