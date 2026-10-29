import { describe, expect, it } from "vitest";
import { SLUG_MAX, isUuid, sessionSlug, shortId } from "./session-slug";

describe("sessionSlug", () => {
  it("lowercases and joins words with single dashes", () => {
    expect(sessionSlug("Live guest share plan")).toBe("live-guest-share-plan");
    expect(sessionSlug("  Fix: login / OAuth (v2)!! ")).toBe(
      "fix-login-oauth-v2"
    );
    expect(sessionSlug("snake_case.and.dots")).toBe("snake-case-and-dots");
  });

  it("folds accents and drops emoji", () => {
    expect(sessionSlug("Café Résumé über")).toBe("cafe-resume-uber");
    expect(sessionSlug("🚀 Ship it! 🎉")).toBe("ship-it");
  });

  it("is `session` when nothing readable is left", () => {
    for (const name of ["", "   ", "🚀🎉", "!!!", "اردو نام"]) {
      expect(sessionSlug(name)).toBe("session");
    }
  });

  it("drops a truncated title's ellipsis", () => {
    expect(sessionSlug("Read the brief at docs/plans/x...")).toBe(
      "read-the-brief-at-docs-plans-x"
    );
  });

  it("caps the length on a word boundary", () => {
    const slug = sessionSlug(
      "Replace session links with readable ones built from the session name"
    );
    expect(slug.length).toBeLessThanOrEqual(SLUG_MAX);
    expect(slug).toBe("replace-session-links-with-readable-ones-built");
    expect(sessionSlug("x".repeat(80))).toBe("x".repeat(SLUG_MAX));
  });

  it("is stable on its own output", () => {
    const once = sessionSlug("Web perf: audit #3 — Café");
    expect(sessionSlug(once)).toBe(once);
  });
});

describe("short ids", () => {
  it("takes the uuid's first group", () => {
    const id = "920654A6-13dd-4073-8b7a-e082d3650f95";
    expect(isUuid(id)).toBe(true);
    expect(isUuid("abc")).toBe(false);
    expect(shortId(id)).toBe("920654a6");
  });
});
