import { reviewSchema, type Review } from "./types";

export const REVIEW_FENCE = "agentos-review";

const FENCE = new RegExp(
  "(`{3,}|~{3,})[ \\t]*" + REVIEW_FENCE + "[^\\n]*\\n([\\s\\S]*?)\\n?\\1",
  "g"
);

export type ParsedReview =
  { ok: true; review: Review } | { ok: false; error: string };

// The last agentos-review block in the analyst's reply, validated.
export function parseReview(text: string): ParsedReview {
  const blocks = [...text.matchAll(FENCE)];
  if (!blocks.length)
    return { ok: false, error: "The reply had no agentos-review block" };
  return parseReviewJson(blocks[blocks.length - 1][2]);
}

export function parseReviewJson(raw: string): ParsedReview {
  let json: unknown;
  try {
    json = JSON.parse(raw.trim());
  } catch {
    return { ok: false, error: "The agentos-review block isn't valid JSON" };
  }
  const got = reviewSchema.safeParse(json);
  if (!got.success) {
    const issue = got.error.issues[0];
    return {
      ok: false,
      error: `The agentos-review block is invalid: ${issue.path.join(".") || "block"} ${issue.message}`,
    };
  }
  const review = got.data;
  return {
    ok: true,
    review: { ...review, prompt: review.prompt?.trim() || null },
  };
}
